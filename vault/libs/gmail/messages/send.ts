/**
 * Gmail Send Operations
 *
 * Send, reply, and forward emails.
 */

import type {
  GmailGlobals,
  SendEmailOutput,
  ReplyEmailOutput,
  ForwardEmailOutput,
  AttachmentInput,
  AttachmentResult,
} from '../schemas';

import { gmailFetch, normalizeRecipients, getSyncVersion } from '../helpers';

import { Validation, ContractDrift, NotFound, throwForStatus } from '@vallum/_runtime';

/**
 * Send a new email with optional attachments.
 */
export async function sendEmail(opts: {
  xsrf: string;
  account: number;
  globals: GmailGlobals;
  to: string | string[];
  subject: string;
  body: string;
  cc?: string[] | null;
  bcc?: string[] | null;
  attachments?: AttachmentInput[] | null;
  scheduleTime?: number | null;
}): Promise<SendEmailOutput> {
  const { xsrf, account, globals, subject, body } = opts;
  const { toArray, toField } = normalizeRecipients(opts.to);
  const cc = opts.cc ?? null;
  const bcc = opts.bcc ?? null;
  const attachments = opts.attachments ?? null;
  const scheduleTime = opts.scheduleTime ?? null;
  const isScheduled = scheduleTime !== null;
  const hasAttachments = attachments && attachments.length > 0;

  const timestamp = Date.now();
  const fromEmail = globals.g10;
  const fromName = fromEmail.split('@')[0];
  const htmlBody = `<div dir="ltr">${body.replace(/\n/g, '<br>')}</div>`;

  // Build CC/BCC fields: [[1, email, name], ...] or null
  const ccField =
    cc && cc.length > 0
      ? cc.map((email) => [1, email, email.split('@')[0]])
      : null;
  const bccField =
    bcc && bcc.length > 0
      ? bcc.map((email) => [1, email, email.split('@')[0]])
      : null;

  // Generate IDs - scheduled send needs extraHex in syncId
  const msgNum = Math.floor(Math.random() * 9e18).toString();
  const threadId = 'thread-a:r' + msgNum;
  const msgId = 'msg-a:r' + msgNum;
  const syncHex = Math.random().toString(16).slice(2, 18);
  const extraHex = Math.random().toString(16).slice(2, 18);
  const syncId = isScheduled
    ? `s:${syncHex}|#${msgId}|${extraHex}`
    : `s:${syncHex}|#${msgId}|0`;

  // Upload attachments if provided (inline to match original pattern)
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

      // Validate base64 content isn't corrupted (e.g., encoded "undefined")
      if (!base64Data || base64Data.length === 0) {
        throw new Validation(
          `Attachment "${fileName}" has empty base64Data. File content was not loaded correctly.`,
        );
      }
      const decodedPreviewSize = Math.floor((base64Data.length * 3) / 4);
      if (decodedPreviewSize <= 20) {
        const preview = atob(base64Data);
        if (
          preview === 'undefined' ||
          preview === 'null' ||
          preview === '[object Object]'
        ) {
          throw new Validation(
            `Attachment "${fileName}" base64Data decodes to "${preview}": file content was not loaded correctly.`,
          );
        }
      }

      // Generate attachment ID
      const attachmentId = 'f_' + Math.random().toString(36).slice(2, 11);

      // Convert base64 to bytes
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const fileSize = bytes.length;

      // Step 1: Initiate upload
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

      // Step 2: Upload file bytes
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

      // Build attachment array for message payload
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

  // Build regular message structure (78 fields)
  function buildMsg(
    ts: number,
    labels: string[],
    finalFlag: number | null,
  ): unknown[] {
    return [
      msgId, // [0]
      [1, fromEmail, fromName, null, null, null, null, null, null, fromEmail], // [1]
      toField, // [2] Recipients [[1, email, name], ...]
      ccField, // [3] CC recipients
      bccField, // [4] BCC recipients
      null, // [5]
      ts, // [6]
      subject, // [7]
      [null, [[0, htmlBody]], null, null, null, null, 1], // [8]
      null, // [9]
      labels, // [10]
      hasAttachments ? attachmentArrays : null, // [11] attachments
      null,
      null,
      null,
      null,
      null, // [12-16]
      ts, // [17]
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
      null,
      null,
      null,
      null,
      null,
      null,
      null, // [30-40]
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
      finalFlag, // [74]
      null,
      null, // [75-76]
      [], // [77]
    ];
  }

  // Build scheduled message structure (different positions for schedule data)
  function buildScheduledMsg(labels: string[]): unknown[] {
    return [
      msgId, // [0]
      [1, fromEmail, fromName, null, null, null, null, null, null, fromEmail], // [1]
      toField, // [2] Recipients [[1, email, name], ...]
      ccField, // [3] CC recipients
      bccField, // [4] BCC recipients
      null, // [5]
      scheduleTime, // [6] scheduled time
      subject, // [7]
      [null, [[0, htmlBody]], null, null, null, null, 1], // [8]
      null, // [9]
      labels, // [10]
      hasAttachments ? attachmentArrays : null, // [11]
      null,
      null,
      null,
      null,
      null, // [12-16]
      scheduleTime, // [17] scheduled time
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
      null, // [52]
      scheduleTime, // [53] scheduled time
      null, // [54]
      extraHex, // [55] extra hex
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
      null, // [56-73]
      1, // [74] = 1 for scheduled flag
      null,
      null, // [75-76]
      [], // [77]
    ];
  }

  // Step 1: Create draft
  const draftLabels = ['^all', '^r', '^r_bt', '^io_im', '^io_imc3'];
  const draftMsg = buildMsg(timestamp, draftLabels, null);
  const draftThreadData = [
    threadId,
    [null, null, [[subject, null, timestamp, threadId, [draftMsg]]]],
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

  // Step 2: Send or Schedule
  const ts2 = Date.now();
  let sendMsg: unknown[];
  let sendOp: unknown[];
  let sendPostData: unknown[];

  if (isScheduled) {
    // Scheduled send uses opCode 24 and different message structure
    const scheduledLabels = [
      '^all',
      '^io_unim',
      '^smartlabel_personal',
      '^scheduled',
      '^f_bt',
      '^f_btns',
      '^f_cl',
      '^a',
    ];
    sendMsg = buildScheduledMsg(scheduledLabels);
    const sendThreadData = [
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
    sendOp = [24, sendThreadData];
    sendPostData = [
      [null, null, 2],
      [[sendOp]],
      null,
      [timestamp, 1, ts2, 1, 277],
      2,
    ];
  } else {
    // Regular send uses opCode 2
    const sendLabels = [
      '^all',
      '^pfg',
      '^f_bt',
      '^f_btns',
      '^f_cl',
      '^io_im',
      '^io_imc3',
    ];
    sendMsg = buildMsg(ts2, sendLabels, 1);
    const sendThreadData = [
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
    sendOp = [2, sendThreadData];
    sendPostData = [
      [null, null, 2],
      [[sendOp]],
      null,
      [timestamp, 1, ts2, 1, 47],
      2,
    ];
  }

  await gmailFetch(
    xsrf,
    account,
    globals,
    '/i/s?hl=en&c=2&rt=r&pt=ji',
    sendPostData,
  );

  // Step 3: Finalize (needed for attachments or scheduled)
  if (hasAttachments || isScheduled) {
    const finalizePayload = [[[threadId, 1, [msgId]]], isScheduled ? 3 : 1];
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
    from: fromEmail,
    to: toArray,
    cc: cc && cc.length > 0 ? cc : null,
    bcc: bcc && bcc.length > 0 ? bcc : null,
    subject,
    scheduled: isScheduled,
    scheduledFor: isScheduled ? new Date(scheduleTime).toISOString() : null,
    threadId,
    messageId: msgId,
    attachments: hasAttachments ? attachmentResults : null,
  };
}

/**
 * Reply to an existing email thread with optional attachments.
 */
export async function replyEmail(opts: {
  xsrf: string;
  account: number;
  globals: GmailGlobals;
  threadId: string;
  originalMsgId: string;
  to: string | string[];
  subject: string;
  body: string;
  cc?: string[] | null;
  bcc?: string[] | null;
  attachments?: AttachmentInput[] | null;
}): Promise<ReplyEmailOutput> {
  const { xsrf, account, globals, threadId, originalMsgId, subject, body } =
    opts;
  const { toArray, toField } = normalizeRecipients(opts.to);
  const cc = opts.cc ?? null;
  const bcc = opts.bcc ?? null;
  const attachments = opts.attachments ?? null;
  const hasAttachments = attachments && attachments.length > 0;

  const msgNum = Math.floor(Math.random() * 9e18).toString();
  const msgId = 'msg-a:r' + msgNum;
  const syncHex = Math.random().toString(16).slice(2, 18);
  const syncId = `s:${syncHex}|#${msgId}|0`;
  const timestamp = Date.now();
  const fromEmail = globals.g10;
  const fromName = fromEmail.split('@')[0];
  const htmlBody = `<div dir="ltr">${body.replace(/\n/g, '<br>')}</div>`;

  // Build CC/BCC fields: [[1, email, name], ...] or null
  const ccField =
    cc && cc.length > 0
      ? cc.map((email) => [1, email, email.split('@')[0]])
      : null;
  const bccField =
    bcc && bcc.length > 0
      ? bcc.map((email) => [1, email, email.split('@')[0]])
      : null;

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

  // Build reply message with In-Reply-To at position [15]
  function buildReplyMsg(ts: number, labels: string[]): unknown[] {
    return [
      msgId, // [0]
      [1, fromEmail, fromName, null, null, null, null, null, null, fromEmail], // [1]
      toField, // [2] Recipients [[1, email, name], ...]
      ccField, // [3] CC recipients
      bccField, // [4] BCC recipients
      null, // [5]
      ts, // [6]
      subject, // [7]
      [null, [[0, htmlBody]], null, null, null, null, 1], // [8]
      null, // [9]
      labels, // [10]
      hasAttachments ? attachmentArrays : null, // [11] attachments
      null,
      null, // [12-13]
      null, // [14]
      originalMsgId, // [15] In-Reply-To for threading
      null, // [16]
      ts, // [17]
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
  }

  // Step 1: Create draft
  const draftLabels = ['^all', '^r', '^r_bt', '^io_im', '^io_imc3'];
  const draftMsg = buildReplyMsg(timestamp, draftLabels);
  const draftThreadData = [
    threadId,
    [null, null, [[subject, null, timestamp, threadId, [draftMsg]]]],
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

  // Step 2: Send reply with opCode 10 for threading
  const ts2 = Date.now();
  const replyLabels = ['^all', '^pfg', '^f_bt', '^f_btns', '^f_cl'];
  const sendMsg = buildReplyMsg(ts2, replyLabels);
  const sendThreadData = [
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
  ];
  const sendOp = [10, sendThreadData]; // opCode 10 for threaded reply
  const sendPostData = [
    [null, null, 10],
    [[sendOp]],
    null,
    [timestamp, 1, ts2, 1, 47],
    2,
  ];

  await gmailFetch(
    xsrf,
    account,
    globals,
    '/i/s?hl=en&c=2&rt=r&pt=ji',
    sendPostData,
  );

  // Step 3: Finalize (needed for attachments)
  if (hasAttachments) {
    const finalizePayload = [[[threadId, 1, [msgId]]], 1];
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
    from: fromEmail,
    to: toArray,
    cc: cc && cc.length > 0 ? cc : null,
    bcc: bcc && bcc.length > 0 ? bcc : null,
    subject,
    threadId,
    originalMsgId,
    newMessageId: msgId,
    attachments: hasAttachments ? attachmentResults : null,
  };
}

/**
 * Forward an email to another recipient with optional attachments.
 */
export async function forwardEmail(opts: {
  xsrf: string;
  account: number;
  globals: GmailGlobals;
  threadId: string;
  originalMsgId: string;
  to: string | string[];
  cc?: string[] | null;
  bcc?: string[] | null;
  message?: string;
  attachments?: AttachmentInput[] | null;
  inThread?: boolean;
  wholeThread?: boolean;
}): Promise<ForwardEmailOutput> {
  const { xsrf, account, globals, threadId, originalMsgId } = opts;
  const { toArray, toField } = normalizeRecipients(opts.to);
  const cc = opts.cc ?? null;
  const bcc = opts.bcc ?? null;
  const message = opts.message ?? '';
  const attachments = opts.attachments ?? null;
  const inThread = opts.inThread ?? true;
  const wholeThread = opts.wholeThread ?? true;
  const hasUserAttachments = attachments && attachments.length > 0;

  const timestamp = Date.now();
  const fromEmail = globals.g10;
  const fromName = fromEmail.split('@')[0];

  // Build CC/BCC fields: [[1, email, name], ...] or null
  const ccField =
    cc && cc.length > 0
      ? cc.map((email) => [1, email, email.split('@')[0]])
      : null;
  const bccField =
    bcc && bcc.length > 0
      ? bcc.map((email) => [1, email, email.split('@')[0]])
      : null;

  // For new thread forward, create new IDs; for in-thread, reuse threadId
  const newThreadId = inThread
    ? threadId
    : 'thread-a:r' + Math.floor(Math.random() * 9e18).toString();
  const msgNum = Math.floor(Math.random() * 9e18).toString();
  const msgId = 'msg-a:r' + msgNum;
  const syncHex = Math.random().toString(16).slice(2, 18);
  const syncId = `s:${syncHex}|#${msgId}|0`;

  // Fetch thread to get content
  const fetchPayload = threadId.startsWith('thread-a:r')
    ? [[[threadId, null, null]], 2]
    : [[[threadId, 1, null, null, 1]], 2];

  const fetchData = await gmailFetch<unknown[]>(
    xsrf,
    account,
    globals,
    '/i/fd?hl=en&c=0&rt=r&pt=ji',
    fetchPayload,
  );

  if (!fetchData[1] || !fetchData[1][0]) {
    throw new NotFound('Thread not found');
  }

  // Parse thread data
  const td = fetchData[1][0] as unknown[];
  let originalSubject = 'Forwarded Message';
  const allMessages: Array<{
    msgId: string;
    from: { email: string; name: string };
    to: Array<{ email: string; name: string }>;
    timestamp: number;
    body: string;
    messageId: string | null; // RFC822 Message-ID for threading
  }> = [];

  // Get subject from thread metadata
  if (
    td[1] &&
    (td[1] as unknown[])[0] &&
    ((td[1] as unknown[])[0] as unknown[])[1]
  ) {
    originalSubject = ((td[1] as unknown[])[0] as unknown[])[1] as string;
  }

  // Extract message bodies
  const msgBodyMap: Record<string, unknown[]> = {};
  if (td[2] && Array.isArray(td[2])) {
    for (const bodyEntry of td[2] as unknown[][]) {
      if (bodyEntry && bodyEntry[0] && bodyEntry[1]) {
        msgBodyMap[bodyEntry[0] as string] = bodyEntry[1] as unknown[];
      }
    }
  }

  // Extract message metadata
  if (
    td[1] &&
    (td[1] as unknown[])[1] &&
    Array.isArray((td[1] as unknown[])[1])
  ) {
    for (const meta of (td[1] as unknown[])[1] as unknown[][]) {
      if (!meta || !meta[0] || !(meta[0] as string).startsWith('msg-'))
        continue;

      const msgIdLocal = meta[0] as string;
      const senderData = meta[1] as unknown[];
      const msgTimestamp = (meta[2] || timestamp) as number;

      let senderEmail = '';
      let senderName = '';
      if (senderData) {
        senderEmail = (senderData[1] || '') as string;
        senderName = (senderData[2] || senderEmail.split('@')[0]) as string;
      }

      // Extract body HTML and recipient
      let bodyHtml = '';
      const bodyData = msgBodyMap[msgIdLocal];
      const msgRecipients: Array<{ email: string; name: string }> = [];

      // RFC822 Message-ID for threading (e.g., <CAB-d=...@mail.gmail.com>)
      let rfc822MessageId: string | null = null;

      if (bodyData) {
        // Extract recipients from bodyData[0] - [[1, email, name], ...]
        if (bodyData[0] && Array.isArray(bodyData[0])) {
          for (const recipient of bodyData[0] as unknown[][]) {
            if (recipient && recipient[1]) {
              msgRecipients.push({
                email: (recipient[1] as string) ?? '',
                name:
                  (recipient[2] as string) ??
                  (recipient[1] as string).split('@')[0],
              });
            }
          }
        }

        // Extract body HTML from bodyData[5][1][*][2][1]
        if (bodyData[5] && (bodyData[5] as unknown[])[1]) {
          for (const part of (bodyData[5] as unknown[])[1] as unknown[][]) {
            if (part && part[2] && (part[2] as unknown[])[1]) {
              bodyHtml += (part[2] as unknown[])[1];
            }
          }
        }

        // Extract RFC822 Message-ID from bodyData[7]
        if (bodyData[7] && typeof bodyData[7] === 'string') {
          rfc822MessageId = bodyData[7] as string;
        }
      }

      allMessages.push({
        msgId: msgIdLocal,
        from: { email: senderEmail, name: senderName },
        to: msgRecipients,
        timestamp: msgTimestamp,
        body: bodyHtml,
        messageId: rfc822MessageId,
      });
    }
  }

  const messageCount = allMessages.length;

  // Build forward subject and body
  const fwdSubject = originalSubject.startsWith('Fwd:')
    ? originalSubject
    : 'Fwd: ' + originalSubject;

  // Gmail date format: "Tue, Jan 20, 2026 at 9:24 PM"
  function formatGmailDate(ts: number): string {
    const d = new Date(ts);
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    const day = days[d.getDay()];
    const month = months[d.getMonth()];
    const date = d.getDate();
    const year = d.getFullYear();
    let hours = d.getHours();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    const mins = d.getMinutes().toString().padStart(2, '0');
    return `${day}, ${month} ${date}, ${year} at ${hours}:${mins} ${ampm}`;
  }

  let forwardedHtml = '<div dir="ltr">';

  // Personal message at top
  if (message) {
    forwardedHtml += message.replace(/\n/g, '<br>') + '<br><br>';
  }

  // Helper to format recipients for display
  function formatRecipients(
    recipients: Array<{ email: string; name: string }>,
  ): string {
    if (!recipients || recipients.length === 0) return '';
    return recipients.map((r) => `${r.name} &lt;${r.email}&gt;`).join(', ');
  }

  if (wholeThread && allMessages.length > 1) {
    // Forward whole thread - each message gets its own forwarded header
    for (let i = 0; i < allMessages.length; i++) {
      const msg = allMessages[i];
      const dateStr = formatGmailDate(msg.timestamp);

      forwardedHtml += '<div class="gmail_quote gmail_quote_container">';
      forwardedHtml +=
        '<div dir="ltr" class="gmail_attr">---------- Forwarded message ---------<br>';
      forwardedHtml += `From: <strong class="gmail_sendername" dir="auto">${msg.from.name}</strong> `;
      forwardedHtml += `<span dir="auto">&lt;${msg.from.email}&gt;</span><br>`;
      forwardedHtml += `Date: ${dateStr}<br>`;
      forwardedHtml += `Subject: ${originalSubject}<br>`;
      if (msg.to.length > 0) {
        forwardedHtml += `To: ${formatRecipients(msg.to)}<br>`;
      }
      forwardedHtml += '</div><br><br>';
      forwardedHtml += `<div dir="ltr">${msg.body || ''}</div>`;
      forwardedHtml += '</div>';

      if (i < allMessages.length - 1) {
        forwardedHtml += '<br>';
      }
    }
  } else {
    // Forward single message - show original recipient in header
    const msg = allMessages[0] || {
      from: { email: fromEmail, name: fromName },
      to: [],
      timestamp,
      body: '',
    };
    const dateStr = formatGmailDate(msg.timestamp);
    forwardedHtml += '<div class="gmail_quote gmail_quote_container">';
    forwardedHtml +=
      '<div dir="ltr" class="gmail_attr">---------- Forwarded message ---------<br>';
    forwardedHtml += `From: <strong class="gmail_sendername" dir="auto">${msg.from.name}</strong> `;
    forwardedHtml += `<span dir="auto">&lt;${msg.from.email}&gt;</span><br>`;
    forwardedHtml += `Date: ${dateStr}<br>`;
    forwardedHtml += `Subject: ${originalSubject}<br>`;
    if (msg.to.length > 0) {
      forwardedHtml += `To: ${formatRecipients(msg.to)}<br>`;
    }
    forwardedHtml += '</div><br><br>';
    forwardedHtml += `<div dir="ltr">${msg.body || ''}</div>`;
    forwardedHtml += '</div>';
  }

  forwardedHtml += '</div>';

  // Get RFC822 Message-ID from the original message for threading
  // Find the message matching originalMsgId, or use the last message in thread
  const originalMessage =
    allMessages.find((m) => m.msgId === originalMsgId) ||
    allMessages[allMessages.length - 1];
  const rfc822Reference = originalMessage?.messageId || null;

  // Extract original attachments from thread messages to include in forward
  // Parse bodyData[13] for each message (same structure as listAttachments)
  const originalAttachments: Array<{
    url: string;
    filename: string;
    mimeType: string;
    size: number;
  }> = [];

  const messagesToInclude = wholeThread
    ? allMessages.map((m) => m.msgId)
    : [originalMsgId];

  for (const includeMsgId of messagesToInclude) {
    const bodyData = msgBodyMap[includeMsgId];
    if (!bodyData || !bodyData[13] || !Array.isArray(bodyData[13])) continue;

    for (const att of bodyData[13] as unknown[][]) {
      if (!att || !att[0] || !(att[0] as unknown[])[3]) continue;
      const attInfo = (att[0] as unknown[])[3] as unknown[];
      const attUrl = attInfo[1] as string;
      const attFilename = attInfo[2] as string;
      const attMimeType = attInfo[3] as string;
      const attSize = attInfo[4] as number;
      if (attUrl && attFilename) {
        originalAttachments.push({
          url: attUrl,
          filename: attFilename,
          mimeType: attMimeType,
          size: attSize,
        });
      }
    }
  }

  // Upload attachments: original thread attachments + user-provided
  const attachmentArrays: unknown[][] = [];
  const attachmentResults: AttachmentResult[] = [];

  // Re-upload original attachments by downloading from URL then uploading
  for (const origAtt of originalAttachments) {
    const dlResponse = await fetch(origAtt.url, { credentials: 'include' });
    if (!dlResponse.ok) continue;

    const dlBytes = new Uint8Array(await dlResponse.arrayBuffer());
    const origAttId = 'f_' + Math.random().toString(36).slice(2, 11);

    const origInitUrl = `/_/upload?authuser=${account}&dcp=asu-n`;
    const origInitResponse = await fetch(origInitUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'x-goog-upload-command': 'start',
        'x-goog-upload-file-name': encodeURIComponent(origAtt.filename),
        'x-goog-upload-header-content-length': dlBytes.length.toString(),
        'x-goog-upload-header-content-type': origAtt.mimeType,
        'x-goog-upload-protocol': 'resumable',
      },
      body: JSON.stringify([msgId]),
      credentials: 'include',
    });

    if (!origInitResponse.ok) continue;

    const origUploadUrl = origInitResponse.headers.get('x-goog-upload-url');
    if (!origUploadUrl) continue;

    const origUploadResponse = await fetch(origUploadUrl, {
      method: 'POST',
      headers: {
        'Content-Type': origAtt.mimeType,
        'x-goog-upload-command': 'upload, finalize',
        'x-goog-upload-file-name': encodeURIComponent(origAtt.filename),
        'x-goog-upload-offset': '0',
      },
      body: dlBytes,
      credentials: 'include',
    });

    if (!origUploadResponse.ok) continue;

    const origBlobRef = await origUploadResponse.text();
    attachmentArrays.push([
      origAtt.mimeType,
      origAtt.filename,
      dlBytes.length,
      null,
      origAttId,
      null,
      0,
      [],
      null,
      origBlobRef,
    ]);
    attachmentResults.push({
      fileName: origAtt.filename,
      size: dlBytes.length,
    });
  }

  if (hasUserAttachments) {
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

  // Combined flag: original thread attachments + user-provided
  const hasAttachments = attachmentArrays.length > 0;

  // Build forward message
  function buildForwardMsg(ts: number, labels: string[]): unknown[] {
    return [
      msgId, // [0]
      [1, fromEmail, fromName, null, null, null, null, null, null, fromEmail], // [1]
      toField, // [2] Recipients [[1, email, name], ...]
      ccField, // [3] CC recipients
      bccField, // [4] BCC recipients
      null, // [5]
      ts, // [6]
      fwdSubject, // [7]
      [null, [[0, forwardedHtml]], null, null, null, null, 1], // [8]
      null, // [9]
      labels, // [10]
      hasAttachments ? attachmentArrays : null, // [11] attachments
      null,
      null, // [12-13]
      null, // [14]
      inThread ? rfc822Reference : null, // [15] RFC822 Message-ID reference for threading
      null, // [16]
      ts, // [17]
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
  }

  const syncVersion = await getSyncVersion(xsrf, account, globals);

  // Step 1: Create draft
  const draftLabels = ['^all', '^r', '^r_bt', '^io_im', '^io_imc3'];
  const draftMsg = buildForwardMsg(timestamp, draftLabels);
  const draftThreadData = [
    newThreadId,
    [null, null, [[fwdSubject, null, timestamp, newThreadId, [draftMsg]]]],
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
    '/i/s?hl=en&c=2&rt=r&pt=ji',
    draftPostData,
  );

  // Step 2: Send forward
  const ts2 = Date.now();
  const sendLabels = inThread
    ? ['^all', '^pfg', '^f_bt', '^f_btns', '^f_cl']
    : ['^all', '^pfg', '^f_bt', '^f_btns', '^f_cl', '^io_im', '^io_imc3'];
  const sendMsg = buildForwardMsg(ts2, sendLabels);

  let sendThreadData: unknown[];
  let sendOp: unknown[];
  let sendPostData: unknown[];

  if (inThread) {
    // opCode 8 for in-thread forward (like Gmail uses)
    // Also add opCode 9 to update thread metadata with ^io_fwd label
    sendThreadData = [
      newThreadId,
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
    ];
    sendOp = [8, sendThreadData];
    // Thread metadata update: add ^io_fwd label
    const threadMetaOp = [
      9,
      [
        newThreadId,
        [null, null, null, null, null, null, [['^io_fwd'], null, [msgId]]],
      ],
    ];
    sendPostData = [
      [null, null, 2],
      [[sendOp], threadMetaOp],
      null,
      [timestamp, 1, ts2, 1, 175],
      2,
    ];
  } else {
    // opCode 2 for new thread
    sendThreadData = [
      newThreadId,
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
    sendOp = [2, sendThreadData];
    sendPostData = [
      [null, null, 2],
      [[sendOp]],
      null,
      [timestamp, 1, ts2, 1, 47],
      2,
    ];
  }

  await gmailFetch(
    xsrf,
    account,
    globals,
    '/i/s?hl=en&c=3&rt=r&pt=ji',
    sendPostData,
  );

  // Step 3: Finalize (needed for attachments)
  if (hasAttachments) {
    const finalizePayload = [[[newThreadId, 1, [msgId]]], 1];
    await gmailFetch(
      xsrf,
      account,
      globals,
      '/i/fd?hl=en&c=4&rt=r&pt=ji',
      finalizePayload,
    );
  }

  return {
    success: true,
    from: fromEmail,
    to: toArray,
    cc: cc && cc.length > 0 ? cc : null,
    bcc: bcc && bcc.length > 0 ? bcc : null,
    subject: fwdSubject,
    originalSubject,
    threadId: newThreadId,
    originalMsgId,
    newMessageId: msgId,
    inThread,
    wholeThread,
    messageCount,
    attachments: attachmentResults,
  };
}
