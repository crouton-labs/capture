/**
 * Gmail Draft Operations
 *
 * Create, list, edit, and send drafts.
 */

import type {
  GmailGlobals,
  ListDraftsOutput,
  CreateDraftOutput,
  SendDraftOutput,
  EditDraftOutput,
  AttachmentInput,
  AttachmentResult,
} from '../schemas';

import {
  gmailFetch,
  generateIds,
  normalizeRecipients,
  getSyncVersion,
  parseListResponse,
} from '../helpers';

import { ContractDrift, NotFound, throwForStatus } from '@vallum/_runtime';

/**
 * List draft emails.
 */
export async function listDrafts(opts: {
  xsrf: string;
  account: number;
  globals: GmailGlobals;
  count?: number;
}): Promise<ListDraftsOutput> {
  const { xsrf, account, globals } = opts;
  const count = opts.count ?? 10;
  const timestamp = Date.now();

  const payload = [
    [
      6, // Drafts viewType
      50,
      null,
      'in:^r',
      [null, null, null, null, 0],
      `itemlist-ViewType(6)-${account}`,
      account,
      count,
      null,
      0,
      null,
      null,
      null,
      1,
      null,
      null,
      null,
      null,
      0,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      1,
      0,
      '',
      null,
      null,
      [timestamp, null, null, account],
    ],
    null,
    [0, 5, null, null, 1, 1, 1],
  ];

  const data = await gmailFetch<unknown[]>(
    xsrf,
    account,
    globals,
    '/i/bv?hl=en&c=0&rt=r&pt=ji',
    payload,
  );

  const result = parseListResponse(data);

  return {
    drafts: result.messages.map((msg) => ({
      threadId: msg.threadId,
      messageId: msg.messageId,
      subject: msg.subject,
      to: null, // Recipient not available in list response - use readEmail to get actual recipient
      date: msg.date,
      snippet: msg.snippet,
    })),
    totalCount: result.totalCount,
  };
}

/**
 * Create a new draft email with optional attachments.
 */
export async function createDraft(opts: {
  xsrf: string;
  account: number;
  globals: GmailGlobals;
  to: string | string[];
  subject: string;
  body: string;
  cc?: string[] | null;
  bcc?: string[] | null;
  attachments?: AttachmentInput[] | null;
  threadId?: string;
}): Promise<CreateDraftOutput> {
  const { xsrf, account, globals, subject, body } = opts;
  const { toArray, toField } = normalizeRecipients(opts.to);
  const cc = opts.cc ?? null;
  const bcc = opts.bcc ?? null;
  const attachments = opts.attachments ?? null;
  const existingThreadId = opts.threadId;
  const isReply = !!existingThreadId;
  const hasAttachments = attachments && attachments.length > 0;

  const { threadId: newThreadId, msgId, syncId } = generateIds();
  const timestamp = Date.now();
  const fromEmail = globals.g10;
  const fromName = fromEmail.split('@')[0];
  const htmlBody = `<div dir="ltr">${body.replace(/\n/g, '<br>')}</div>`;
  const finalThreadId = existingThreadId ?? newThreadId;

  // Build CC/BCC fields: [[1, email, name], ...] or null
  const ccField =
    cc && cc.length > 0
      ? cc.map((email) => [1, email, email.split('@')[0]])
      : null;
  const bccField =
    bcc && bcc.length > 0
      ? bcc.map((email) => [1, email, email.split('@')[0]])
      : null;

  // For reply drafts, fetch thread to get original message ID for threading
  let originalMsgId: string | null = null;
  if (isReply && existingThreadId) {
    const fetchPayload = existingThreadId.startsWith('thread-a:r')
      ? [[[existingThreadId, null, null]], 2]
      : [[[existingThreadId, 1, null, null, 1]], 2];

    const fetchData = await gmailFetch<unknown[]>(
      xsrf,
      account,
      globals,
      '/i/fd?hl=en&c=0&rt=r&pt=ji',
      fetchPayload,
    );

    if (fetchData[1] && fetchData[1][0]) {
      const threadData = fetchData[1][0] as unknown[];
      // Look for existing messages in thread metadata at threadData[1][1]
      if (
        threadData[1] &&
        (threadData[1] as unknown[])[1] &&
        Array.isArray((threadData[1] as unknown[])[1])
      ) {
        for (const m of (threadData[1] as unknown[])[1] as unknown[][]) {
          if (m && m[0] && (m[0] as string).startsWith('msg-')) {
            originalMsgId = m[0] as string;
            // Get the last message in thread for proper In-Reply-To
          }
        }
      }
    }
  }

  // Upload attachments if provided (inline)
  const attachmentArrays: unknown[][] = [];
  const attachmentResults: AttachmentResult[] = [];

  if (hasAttachments) {
    for (const att of attachments) {
      // Pre-uploaded attachment: skip upload, use blobRef directly
      if ('blobRef' in att) {
        attachmentArrays.push([
          att.mimeType,
          att.fileName,
          att.size,
          null,
          att.attachmentId,
          null,
          0,
          [],
          null,
          att.blobRef,
        ]);
        attachmentResults.push({ fileName: att.fileName, size: att.size });
        continue;
      }

      const { fileName, mimeType, base64Data } = att;
      const attachmentId = 'f_' + Math.random().toString(36).slice(2, 11);

      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const fileSize = bytes.length;

      const initUrl = `/_/upload?authuser=${account}&dcp=asu-n`;
      const initResponse = await fetch(initUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'x-goog-upload-command': 'start',
          'x-goog-upload-file-name': encodeURIComponent(fileName),
          'x-goog-upload-header-content-length': fileSize.toString(),
          'x-goog-upload-header-content-type': mimeType,
          'x-goog-upload-protocol': 'resumable',
        },
        body: JSON.stringify([msgId]),
        credentials: 'include',
      });

      if (!initResponse.ok) {
        throwForStatus(initResponse.status, `Upload init failed for ${fileName}`);
      }

      const uploadUrl = initResponse.headers.get('x-goog-upload-url');
      if (!uploadUrl) {
        throw new ContractDrift(`No upload URL for ${fileName}`);
      }

      const uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'Content-Type': mimeType,
          'x-goog-upload-command': 'upload, finalize',
          'x-goog-upload-file-name': encodeURIComponent(fileName),
          'x-goog-upload-offset': '0',
        },
        body: bytes,
        credentials: 'include',
      });

      if (!uploadResponse.ok) {
        throwForStatus(uploadResponse.status, `Upload failed for ${fileName}`);
      }

      const blobRef = await uploadResponse.text();
      attachmentArrays.push([
        mimeType,
        fileName,
        fileSize,
        null,
        attachmentId,
        null,
        0,
        [],
        null,
        blobRef,
      ]);
      attachmentResults.push({ fileName, size: fileSize });
    }
  }

  const syncVersion = await getSyncVersion(xsrf, account, globals);

  const draftLabels = ['^all', '^r', '^r_bt', '^io_im', '^io_imc3'];

  const draftMsg = [
    msgId, // [0]
    [1, fromEmail, fromName, null, null, null, null, null, null, fromEmail], // [1]
    toField, // [2] Recipients [[1, email, name], ...]
    ccField, // [3] CC recipients
    bccField, // [4] BCC recipients
    null, // [5]
    timestamp, // [6]
    subject, // [7]
    [null, [[0, htmlBody]], null, null, null, null, 1], // [8]
    null, // [9]
    draftLabels, // [10]
    hasAttachments ? attachmentArrays : null, // [11] attachments
    null,
    null, // [12-13]
    null, // [14]
    isReply ? originalMsgId : null, // [15] In-Reply-To for threading
    null, // [16]
    timestamp, // [17]
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null, // [18-29]
    null,
    null,
    null,
    null,
    null, // [30-34]
    [null, null, null, null, null, 0], // [35]
    [null, null, null, 0], // [36]
    null,
    null,
    null,
    null, // [37-40]
    0, // [41]
    [0, 0, 0, null, 0], // [42]
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null, // [43-50]
    syncId, // [51]
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null, // [52-63]
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null, // [64-73]
    null,
    null,
    null, // [74-76]
    [], // [77]
  ];

  const draftThreadData = [
    finalThreadId,
    [null, null, [[subject, null, timestamp, finalThreadId, [draftMsg]]]],
  ];
  const draftOp = [1, draftThreadData];
  const draftPostData = [
    null,
    [[draftOp]],
    [1, syncVersion, null, null, [null, 0], null, 1],
    [null, 1, timestamp, 0, 1],
    2,
  ];

  await gmailFetch(
    xsrf,
    account,
    globals,
    '/i/s?hl=en&c=1&rt=r&pt=ji',
    draftPostData,
  );

  // Finalize (needed for attachments)
  if (hasAttachments) {
    const finalizePayload = [[[finalThreadId, 1, [msgId]]], 1];
    await gmailFetch(
      xsrf,
      account,
      globals,
      '/i/fd?hl=en&c=2&rt=r&pt=ji',
      finalizePayload,
    );
  }

  return {
    success: true,
    mode: isReply ? 'reply' : 'new',
    from: fromEmail,
    to: toArray,
    cc: cc && cc.length > 0 ? cc : null,
    bcc: bcc && bcc.length > 0 ? bcc : null,
    subject,
    threadId: finalThreadId,
    draftId: msgId,
    inReplyTo: originalMsgId,
    attachments: attachmentResults,
  };
}

/**
 * Send an existing draft.
 */
export async function sendDraft(opts: {
  xsrf: string;
  account: number;
  globals: GmailGlobals;
  threadId: string;
  draftId: string;
}): Promise<SendDraftOutput> {
  const { xsrf, account, globals, threadId, draftId } = opts;
  const timestamp = Date.now();
  const fromEmail = globals.g10;
  const fromName = fromEmail.split('@')[0];

  // Step 1: Fetch the draft content to get all necessary fields
  const fetchPayload = [[[threadId, 1, [draftId]]], 1];
  const fetchData = await gmailFetch<unknown[]>(
    xsrf,
    account,
    globals,
    '/i/fd?hl=en&c=1&rt=r&pt=ji',
    fetchPayload,
  );

  if (!fetchData[1] || !fetchData[1][0]) {
    throw new NotFound('Draft not found');
  }

  // Parse draft content from fetchData[1][0]
  const td = fetchData[1][0] as unknown[];
  let toEmail = '';
  let toName = '';
  let subject = '';
  let bodyHtml = '';
  let isReply = false;
  let originalMsgId: string | null = null;
  let sendAttachments: unknown[] | null = null;

  // Message bodies are at td[2], find the one matching draftId
  const bodies = td[2] as unknown[][] | undefined;
  if (Array.isArray(bodies)) {
    for (const body of bodies) {
      if (body && body[0] === draftId) {
        const bodyData = body[1] as unknown[];

        // Extract recipient from bodyData[0]
        if (
          bodyData[0] &&
          Array.isArray(bodyData[0]) &&
          (bodyData[0] as unknown[])[0]
        ) {
          const recipient = (bodyData[0] as unknown[])[0] as unknown[];
          toEmail = (recipient[1] as string) || '';
          toName = (recipient[2] as string) || toEmail.split('@')[0];
        }

        // Extract subject from bodyData[4]
        subject = (bodyData[4] as string) || '';

        // Extract body HTML from bodyData[5]
        if (bodyData[5] && (bodyData[5] as unknown[])[1]) {
          for (const part of (bodyData[5] as unknown[])[1] as unknown[][]) {
            if (part && part[2] && (part[2] as unknown[])[1]) {
              bodyHtml += (part[2] as unknown[])[1] as string;
            }
          }
        }

        // Extract attachments from bodyData[13] and convert from stored format
        // to the flat send format the sync endpoint expects.
        // Stored format per attachment:
        //   [[1, partId, 1, [0, url, name, mime, size, [dlToken, hash, null, b64Token]]], null, attId, null, [path, size, numHash, num, null, magic], null, attId]
        // Send format per attachment:
        //   [mime, name, size, partId, attId, url, 0, [path, size, hash, numHash, num, null, magic, null, dlToken, null, null, null, null, b64Token], null, null, 1, null, null, null, attId]
        if (bodyData[13] && Array.isArray(bodyData[13])) {
          sendAttachments = [];
          for (const storedAtt of bodyData[13] as unknown[][]) {
            const descriptor = storedAtt[0] as unknown[];
            const attId = storedAtt[2] as string;
            const storageMeta = storedAtt[4] as unknown[];
            const inner = descriptor[3] as unknown[];
            // inner = [0, url, filename, mimetype, size, [tokens]]
            const url = inner[1] as string;
            const fileName = inner[2] as string;
            const mimeType = inner[3] as string;
            const size = inner[4] as number;
            const tokens = (inner[5] as unknown[]) ?? [];
            const partId = descriptor[1] as string; // e.g. "0.1"

            // Merge storageMeta + tokens into the full metadata array
            // storageMeta = [path, size, numHash, num, null, magic]
            // tokens = [dlToken, hash, null, b64Token]
            const fullMeta = [
              storageMeta[0], // path
              storageMeta[1], // size
              tokens[1] ?? storageMeta[2], // hash string (prefer token hash)
              storageMeta[2], // numeric hash
              storageMeta[3], // num
              null,
              storageMeta[5], // "b64magic:NK,f,76"
              null,
              tokens[0] ?? null, // download token
              null,
              null,
              null,
              null,
              tokens[3] ?? null, // base64 token
            ];

            sendAttachments.push([
              mimeType,
              fileName,
              size,
              partId,
              attId,
              url,
              0,
              fullMeta,
              null,
              null,
              1,
              null,
              null,
              null,
              attId,
            ]);
          }
        }

        break;
      }
    }
  }

  // Check for other messages in thread metadata at td[1][1] to determine if this is a reply
  if (
    td[1] &&
    (td[1] as unknown[])[1] &&
    Array.isArray((td[1] as unknown[])[1])
  ) {
    for (const m of (td[1] as unknown[])[1] as unknown[][]) {
      if (
        m &&
        Array.isArray(m) &&
        m[0] &&
        m[0] !== draftId &&
        typeof m[0] === 'string' &&
        (m[0] as string).startsWith('msg-')
      ) {
        originalMsgId = m[0] as string;
        isReply = true;
        // Keep iterating to get the latest message for proper In-Reply-To
      }
    }
  }

  // Also detect reply from subject prefix
  if (!isReply && (subject.startsWith('Re:') || subject.startsWith('Fwd:'))) {
    isReply = true;
  }

  if (!toEmail) {
    throw new ContractDrift(
      'Could not parse draft content - check draft exists and has recipient',
    );
  }

  // Step 2: Get sync version (fetched for potential use but not needed for send operation)
  const _syncVersion = await getSyncVersion(xsrf, account, globals);

  // Step 3: Send the draft - reuse draftId (Gmail auto-removes draft when sent with same ID)
  const syncHex = Math.random().toString(16).slice(2, 18);
  const syncId = `s:${syncHex}|#${draftId}|0`;
  const ts2 = Date.now();

  const sendLabels = isReply
    ? ['^all', '^pfg', '^f_bt', '^f_btns', '^f_cl']
    : ['^all', '^pfg', '^f_bt', '^f_btns', '^f_cl', '^io_im', '^io_imc3'];

  // Build send message - reuse draftId for proper draft removal and threading
  const sendMsg = [
    draftId, // Reuse draft ID - Gmail auto-removes draft on successful send
    [1, fromEmail, fromName, null, null, null, null, null, null, fromEmail],
    [[1, toEmail, toName]],
    null,
    null,
    null,
    ts2,
    subject,
    [null, [[0, bodyHtml]], null, null, null, null, 1],
    null,
    sendLabels,
    sendAttachments, // [11] attachments converted from stored format
    null,
    null,
    null,
    isReply ? originalMsgId : null, // [15] In-Reply-To for proper threading
    null,
    ts2,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    [null, null, null, null, null, 0],
    [null, null, null, 0],
    null,
    null,
    null,
    null,
    0,
    [0, 0, 0, null, 0],
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    syncId,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    [],
  ];

  // Use opCode 10 for replies (threaded), opCode 2 for new emails
  const opCode = isReply ? 10 : 2;
  const sendThreadData = isReply
    ? [
        threadId,
        [
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          [sendMsg, originalMsgId, 1, null, [ts2]],
        ],
      ]
    : [
        threadId,
        [
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          [sendMsg, null, 1],
        ],
      ];

  const sendOp = [opCode, sendThreadData];
  const sendPostData = [
    [null, null, opCode],
    [[sendOp]],
    null,
    [timestamp, 1, ts2, 1, 47],
    2,
  ];

  await gmailFetch(
    xsrf,
    account,
    globals,
    '/i/s?hl=en&c=3&rt=r&pt=ji',
    sendPostData,
  );

  return {
    success: true,
    threadId,
    messageId: draftId,
  };
}

/**
 * Edit an existing draft email.
 */
export async function editDraft(opts: {
  xsrf: string;
  account: number;
  globals: GmailGlobals;
  draftId: string;
  threadId?: string;
  to?: string | string[];
  subject?: string;
  body?: string;
  cc?: string[] | null;
  bcc?: string[] | null;
  attachments?: AttachmentInput[] | null;
}): Promise<EditDraftOutput> {
  const { xsrf, account, globals, draftId } = opts;
  const attachments = opts.attachments ?? null;
  const hasAttachments = attachments && attachments.length > 0;
  const timestamp = Date.now();
  const fromEmail = globals.g10;
  const fromName = fromEmail.split('@')[0];

  // Step 1: Resolve threadId (required for fetch + sync to target the correct thread).
  // For reply drafts, draftId.replace('msg-','thread-') is WRONG (the draft lives
  // in the parent thread, not its own). Look up the real threadId from drafts list.
  let threadId = opts.threadId;
  if (!threadId) {
    const draftsPayload = [
      [
        6,
        50,
        null,
        'in:^r',
        [null, null, null, null, 0],
        `itemlist-ViewType(6)-${account}`,
        account,
        50,
        null,
        0,
        null,
        null,
        null,
        1,
        null,
        null,
        null,
        null,
        0,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        1,
        0,
        '',
        null,
        null,
        [timestamp, null, null, account],
      ],
      null,
      [0, 5, null, null, 1, 1, 1],
    ];

    const draftsData = await gmailFetch<unknown[]>(
      xsrf,
      account,
      globals,
      '/i/bv?hl=en&c=0&rt=r&pt=ji',
      draftsPayload,
    );

    // Search draft list for matching draftId to get real threadId
    const threads = draftsData[2] as unknown[][] | undefined;
    if (Array.isArray(threads)) {
      for (const threadWrapper of threads) {
        if (!Array.isArray(threadWrapper)) continue;
        const thread = threadWrapper[0] as unknown[];
        if (!Array.isArray(thread)) continue;
        const tId = thread[3] as string;
        const msgs = thread[4] as unknown[][];
        if (!Array.isArray(msgs)) continue;
        for (const msg of msgs) {
          if (Array.isArray(msg) && msg[0] === draftId) {
            threadId = tId;
            break;
          }
        }
        if (threadId) break;
      }
    }

    if (!threadId) {
      throw new NotFound(
        `Draft ${draftId} not found in recent drafts. Pass threadId explicitly.`,
      );
    }
  }

  // Step 2: Fetch current draft to get existing values
  const fetchPayload = [[[threadId, null, [draftId]]], 2];
  const fetchData = await gmailFetch<unknown[]>(
    xsrf,
    account,
    globals,
    '/i/fd?hl=en&c=1&rt=r&pt=ji',
    fetchPayload,
  );

  if (!fetchData[1] || !fetchData[1][0]) {
    throw new NotFound('Draft not found');
  }

  const fetchedThreadData = fetchData[1][0] as unknown[];

  // Extract actual threadId from response if available
  if (fetchedThreadData[0]) {
    threadId = fetchedThreadData[0] as string;
  }

  // Parse current draft content
  let currentTo = '';
  let currentSubject = '';
  let currentBody = '';
  let originalMsgId: string | null = null;
  let currentAttachments: unknown[][] | null = null;

  const threadInfo = (fetchedThreadData[1] as unknown[])?.[0] as
    | unknown[]
    | undefined;
  const messagesBodies = fetchedThreadData[2] as unknown[][] | undefined;

  if (threadInfo && threadInfo[1]) {
    currentSubject = threadInfo[1] as string;
  }

  // Check for other messages in thread to detect if this is a reply draft
  // Thread metadata at fetchedThreadData[1][1] contains message list
  if (
    fetchedThreadData[1] &&
    (fetchedThreadData[1] as unknown[])[1] &&
    Array.isArray((fetchedThreadData[1] as unknown[])[1])
  ) {
    for (const m of (fetchedThreadData[1] as unknown[])[1] as unknown[][]) {
      if (
        m &&
        m[0] &&
        m[0] !== draftId &&
        (m[0] as string).startsWith('msg-')
      ) {
        originalMsgId = m[0] as string;
        // Keep iterating to get the last message for proper In-Reply-To
      }
    }
  }

  if (
    messagesBodies &&
    messagesBodies.length > 0 &&
    messagesBodies[0] &&
    messagesBodies[0][1]
  ) {
    const bodyData = messagesBodies[0][1] as unknown[];

    // Recipient at bodyData[0][0][1]
    if (
      bodyData[0] &&
      Array.isArray(bodyData[0]) &&
      (bodyData[0] as unknown[])[0]
    ) {
      currentTo = ((bodyData[0] as unknown[])[0] as unknown[])[1] as string;
    }

    // Subject at bodyData[4]
    if (bodyData[4]) {
      currentSubject = bodyData[4] as string;
    }

    // Body at bodyData[5][1]
    if (bodyData[5] && (bodyData[5] as unknown[])[1]) {
      for (const part of (bodyData[5] as unknown[])[1] as unknown[][]) {
        if (part && part[2] && (part[2] as unknown[])[1]) {
          currentBody += (part[2] as unknown[])[1] as string;
        }
      }
    }

    // Existing attachments at bodyData[13]
    if (bodyData[13] && Array.isArray(bodyData[13])) {
      currentAttachments = bodyData[13] as unknown[][];
    }
  }

  // Use new values or keep current
  const finalSubject = opts.subject ?? currentSubject;
  const finalBody = opts.body ?? currentBody;

  // Handle to: can be string, array, or undefined (keep current)
  let toArray: string[];
  let toField: unknown[][] | null;
  if (opts.to !== undefined) {
    const normalized = normalizeRecipients(opts.to);
    toArray = normalized.toArray;
    toField = normalized.toField;
  } else if (currentTo) {
    toArray = [currentTo];
    toField = [[1, currentTo, currentTo.split('@')[0]]];
  } else {
    toArray = [];
    toField = null;
  }

  // CC/BCC: if provided, use new values; otherwise set to null (can't preserve from current draft easily)
  const cc = opts.cc ?? null;
  const bcc = opts.bcc ?? null;

  // Build CC/BCC fields: [[1, email, name], ...] or null
  const ccField =
    cc && cc.length > 0
      ? cc.map((email) => [1, email, email.split('@')[0]])
      : null;
  const bccField =
    bcc && bcc.length > 0
      ? bcc.map((email) => [1, email, email.split('@')[0]])
      : null;

  // Upload attachments if provided
  const attachmentArrays: unknown[][] = [];
  const attachmentResults: AttachmentResult[] = [];

  if (hasAttachments) {
    for (const att of attachments) {
      // Pre-uploaded attachment: skip upload, use blobRef directly
      if ('blobRef' in att) {
        attachmentArrays.push([
          att.mimeType,
          att.fileName,
          att.size,
          null,
          att.attachmentId,
          null,
          0,
          [],
          null,
          att.blobRef,
        ]);
        attachmentResults.push({ fileName: att.fileName, size: att.size });
        continue;
      }

      const { fileName, mimeType, base64Data } = att;
      const attachmentId = 'f_' + Math.random().toString(36).slice(2, 11);

      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const fileSize = bytes.length;

      const initUrl = `/_/upload?authuser=${account}&dcp=asu-n`;
      const initResponse = await fetch(initUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'x-goog-upload-command': 'start',
          'x-goog-upload-file-name': encodeURIComponent(fileName),
          'x-goog-upload-header-content-length': fileSize.toString(),
          'x-goog-upload-header-content-type': mimeType,
          'x-goog-upload-protocol': 'resumable',
        },
        body: JSON.stringify([draftId]),
        credentials: 'include',
      });

      if (!initResponse.ok) {
        throwForStatus(initResponse.status, `Upload init failed for ${fileName}`);
      }

      const uploadUrl = initResponse.headers.get('x-goog-upload-url');
      if (!uploadUrl) {
        throw new ContractDrift(`No upload URL for ${fileName}`);
      }

      const uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'Content-Type': mimeType,
          'x-goog-upload-command': 'upload, finalize',
          'x-goog-upload-file-name': encodeURIComponent(fileName),
          'x-goog-upload-offset': '0',
        },
        body: bytes,
        credentials: 'include',
      });

      if (!uploadResponse.ok) {
        throwForStatus(uploadResponse.status, `Upload failed for ${fileName}`);
      }

      const blobRef = await uploadResponse.text();
      attachmentArrays.push([
        mimeType,
        fileName,
        fileSize,
        null,
        attachmentId,
        null,
        0,
        [],
        null,
        blobRef,
      ]);
      attachmentResults.push({ fileName, size: fileSize });
    }
  }

  // Get sync version
  const syncVersion = await getSyncVersion(xsrf, account, globals);

  // Generate sync ref
  const syncHex = Math.random().toString(16).slice(2, 18);
  const extraHex = Math.random().toString(16).slice(2, 18);
  const syncRef = `s:${syncHex}|#${draftId}|${extraHex}`;

  // Build HTML body
  const htmlBody = finalBody.startsWith('<')
    ? finalBody
    : `<div dir="ltr">${finalBody.replace(/\n/g, '<br>')}</div>`;

  const draftLabels = ['^all', '^r', '^r_bt', '^io_im', '^io_imc3'];

  // Build updated draft message
  const draftMsg = [
    draftId, // [0]
    [1, fromEmail, fromName, null, null, null, null, null, null, fromEmail], // [1]
    toField, // [2] Recipients [[1, email, name], ...] or null
    ccField, // [3] CC recipients
    bccField, // [4] BCC recipients
    null, // [5]
    timestamp, // [6]
    finalSubject, // [7]
    [null, [[0, htmlBody]], null, null, null, null, 1], // [8]
    null, // [9]
    draftLabels, // [10]
    hasAttachments ? attachmentArrays : currentAttachments, // [11] new attachments or preserve existing
    null,
    null, // [12-13]
    null, // [14]
    originalMsgId, // [15] In-Reply-To for threading (preserved from original draft)
    null, // [16]
    timestamp, // [17]
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null, // [18-29]
    null,
    null,
    null,
    null,
    null, // [30-34]
    [null, null, null, null, null, 0], // [35]
    [null, null, null, 0], // [36]
    null,
    null,
    null,
    null, // [37-40]
    0, // [41]
    [0, 0, 0, null, 0], // [42]
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null, // [43-50]
    syncRef, // [51]
    null,
    null,
    null, // [52-54]
    extraHex, // [55]
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null, // [56-67]
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null, // [68-76]
    [], // [77]
  ];

  // Operation code 1 = Draft create/update
  const updateThreadData = [
    threadId,
    [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      [draftMsg, null, 1],
    ],
  ];
  const draftOp = [1, updateThreadData];
  const updatePayload = [
    null,
    [[draftOp]],
    [1, syncVersion, null, null, [null, 0], null, 1],
    [null, 1, timestamp, 0, 1],
    2,
  ];

  await gmailFetch(
    xsrf,
    account,
    globals,
    '/i/s?hl=en&c=2&rt=r&pt=ji',
    updatePayload,
  );

  // Finalize (needed for attachments: links blob to draft message)
  if (hasAttachments) {
    const finalizePayload = [[[threadId, 1, [draftId]]], 1];
    await gmailFetch(
      xsrf,
      account,
      globals,
      '/i/fd?hl=en&c=3&rt=r&pt=ji',
      finalizePayload,
    );
  }

  return {
    success: true,
    draftId,
    threadId,
    to: toArray.length > 0 ? toArray : null,
    cc: cc && cc.length > 0 ? cc : null,
    bcc: bcc && bcc.length > 0 ? bcc : null,
    subject: finalSubject,
    attachments: hasAttachments
      ? attachmentResults
      : currentAttachments
        ? currentAttachments.map((a) => ({
            fileName: a[1] as string,
            size: a[2] as number,
          }))
        : null,
  };
}
