/**
 * Gmail Internal Helpers
 *
 * Shared utilities for Gmail API operations.
 */

import type {
  GmailGlobals,
  MessageSummary,
  ListInboxOutput,
  SearchEmailsOutput,
  AttachmentInput,
  AttachmentResult,
} from '../schemas';

import { ContractDrift, throwForStatus } from '@vallum/_runtime';

/**
 * Build the X-Gmail-BTAI header required for Gmail API calls.
 */
export function buildBtaiHeader(
  globals: GmailGlobals,
  timestamp: number,
): unknown[] {
  return [
    null,
    null,
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
      1,
      null,
      null,
      1,
      null,
      0,
      1,
      1,
      0,
      1,
      null,
      null,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      1,
      1,
      1,
      1,
      1,
      0,
      1,
      'en',
      navigator.userAgent,
      1,
      0,
      25,
      null,
      0,
      1,
      0,
      1,
      1,
      1,
      1,
      1,
      null,
      1,
      1,
      null,
      1,
      1,
      0,
      0,
      null,
      1,
      1,
      null,
      1,
      1,
      null,
      null,
      1,
      null,
      1,
      0,
      1,
      0,
      null,
      0,
      0,
      0,
      null,
      null,
      1,
      100,
      1,
      1,
      0,
      1,
      0,
      null,
      0,
      0,
      0,
      1,
      1,
      null,
      null,
      1,
      null,
      null,
      1,
      null,
      null,
      1,
      null,
      1,
      0,
      1,
      0,
      0,
      0,
      0,
      0,
      null,
      0,
      null,
      0,
      0,
      1,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
    ],
    null,
    globals.g9,
    null,
    25,
    globals.g3,
    1,
    5,
    '',
    -28800000,
    'America/Los_Angeles',
    null,
    null,
    globals.g2,
    '',
    '',
    timestamp,
    null,
    27000,
  ];
}

/**
 * Make a Gmail API request with proper headers.
 */
export async function gmailFetch<T>(
  xsrf: string,
  account: number,
  globals: GmailGlobals,
  path: string,
  body: unknown,
): Promise<T> {
  const timestamp = Date.now();
  const btai = buildBtaiHeader(globals, timestamp);

  const response = await fetch(`/sync/u/${account}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Framework-Xsrf-Token': xsrf,
      'X-Gmail-BTAI': JSON.stringify(btai),
      'X-Google-BTD': '1',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throwForStatus(response.status, `Gmail API error ${response.status}: ${path}`);
  }

  const text = await response.text();
  if (!text) return undefined as T;

  return JSON.parse(text) as T;
}

/**
 * Strip HTML tags and decode entities to plain text.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec)))
    .trim();
}

/**
 * Generate random IDs matching Gmail's format.
 */
export function generateIds(): {
  threadId: string;
  msgId: string;
  syncId: string;
} {
  const msgNum = Math.floor(Math.random() * 9e18).toString();
  const threadId = 'thread-a:r' + msgNum;
  const msgId = 'msg-a:r' + msgNum;
  const syncHex = Math.random().toString(16).slice(2, 18);
  const syncId = `s:${syncHex}|#${msgId}|0`;
  return { threadId, msgId, syncId };
}

/**
 * Normalize recipients input to array and build toField for message payload.
 * Accepts single email string or array of emails.
 */
export function normalizeRecipients(to: string | string[]): {
  toArray: string[];
  toField: unknown[][];
} {
  const toArray = Array.isArray(to) ? to : [to];
  const toField = toArray.map((email) => [1, email, email.split('@')[0]]);
  return { toArray, toField };
}

/**
 * Upload attachments and return arrays for message payload.
 * Returns both the attachment arrays for the message and result info.
 */
export async function uploadAttachmentsForMessage(
  account: number,
  msgId: string,
  attachments: AttachmentInput[],
): Promise<{ arrays: unknown[][]; results: AttachmentResult[] }> {
  const arrays: unknown[][] = [];
  const results: AttachmentResult[] = [];

  for (const att of attachments) {
    // Pre-uploaded attachment: skip upload, use blobRef directly
    if ('blobRef' in att) {
      arrays.push([
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
      results.push({ fileName: att.fileName, size: att.size });
      continue;
    }

    // Inline upload from base64Data
    const { fileName, mimeType, base64Data } = att;

    // Generate attachment ID
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let attachmentId = 'f_';
    for (let i = 0; i < 9; i++) {
      attachmentId += chars[Math.floor(Math.random() * chars.length)];
    }

    // Convert base64 to ArrayBuffer
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

    // Build attachment array for message payload position [11]
    arrays.push([
      mimeType, // [0] MIME type
      fileName, // [1] File name
      fileSize, // [2] File size
      null, // [3]
      attachmentId, // [4] Attachment ID
      null, // [5]
      0, // [6]
      [], // [7]
      null, // [8]
      blobRef, // [9] Blob reference
    ]);

    results.push({ fileName, size: fileSize });
  }

  return { arrays, results };
}

/**
 * Get current sync version from Gmail.
 */
export async function getSyncVersion(
  xsrf: string,
  account: number,
  globals: GmailGlobals,
): Promise<number> {
  const timestamp = Date.now();
  const payload = [
    [1, null, null, 0],
    null,
    [
      1,
      null,
      null,
      null,
      [null, 25],
      null,
      1,
      null,
      [
        '^i',
        '^t',
        '^t_z',
        '^io_im',
        '^f',
        '^r',
        '^all',
        '^s',
        '^k',
        '^b',
        '^scheduled',
      ],
    ],
    [null, 1, timestamp, 0],
    2,
  ];

  const data = await gmailFetch<unknown[]>(
    xsrf,
    account,
    globals,
    '/i/s?hl=en&c=0&rt=r&pt=ji',
    payload,
  );

  const text = JSON.stringify(data);
  const match = text.match(/,(\d{5,})\]\]/);
  return match ? parseInt(match[1]) : 27000;
}

/**
 * Parse list inbox response.
 */
export function parseListResponse(data: unknown[]): ListInboxOutput {
  const messages: MessageSummary[] = [];

  const lastElement = data[data.length - 1] as unknown[];
  const nextCursor =
    Array.isArray(lastElement) && lastElement[0]
      ? (lastElement[0] as string)
      : null;

  const threads = data[2] as unknown[][];
  if (!Array.isArray(threads)) {
    return { messages, nextCursor, totalCount: 0 };
  }

  for (const threadWrapper of threads) {
    if (!Array.isArray(threadWrapper)) continue;

    const thread = threadWrapper[0] as unknown[];
    if (!Array.isArray(thread)) continue;

    const subject = thread[0] as string;
    const threadSnippet = thread[1] as string;
    const threadTimestamp = thread[2] as number;
    const threadId = thread[3] as string;

    if (!threadId || !threadId.startsWith('thread-')) continue;

    const messagesArr = thread[4] as unknown[][];
    if (!Array.isArray(messagesArr)) continue;

    // Use the last message in the thread as the representative
    const lastMsg = messagesArr[messagesArr.length - 1] as unknown[];
    if (!Array.isArray(lastMsg)) continue;

    const messageId = lastMsg[0] as string;
    if (!messageId || !messageId.startsWith('msg-')) continue;

    const senderArr = lastMsg[1] as unknown[];
    const senderEmail = (senderArr?.[1] ?? '') as string;
    const senderName = (senderArr?.[2] ?? senderEmail.split('@')[0]) as string;

    const date = (lastMsg[6] ?? threadTimestamp) as number;
    const snippet = (lastMsg[9] ?? threadSnippet ?? '') as string;
    const labels = (lastMsg[10] ?? []) as string[];
    const unread = labels.includes('^u');

    messages.push({
      threadId,
      messageId,
      subject: subject ?? '(no subject)',
      from: { email: senderEmail, name: senderName },
      date,
      snippet,
      labels,
      unread,
      messageCount: messagesArr.length,
    });
  }

  return { messages, nextCursor, totalCount: messages.length };
}

/**
 * Parse search response.
 */
export function parseSearchResponse(data: unknown[]): SearchEmailsOutput {
  const messages: MessageSummary[] = [];

  // Search results can be at index 19 or 15
  const resultsArray = (
    Array.isArray(data[19])
      ? data[19]
      : Array.isArray(data[15])
        ? data[15]
        : null
  ) as unknown[][] | null;

  if (!resultsArray) {
    return { messages, totalCount: 0 };
  }

  for (const wrapper of resultsArray) {
    if (!Array.isArray(wrapper)) continue;
    if (wrapper[0] !== 2) continue;

    const threadWrappers = wrapper[1] as unknown[][];
    if (!Array.isArray(threadWrappers)) continue;

    for (const threadWrapper of threadWrappers) {
      if (!Array.isArray(threadWrapper)) continue;

      const thread = threadWrapper[0] as unknown[];
      if (!Array.isArray(thread)) continue;

      const subject = thread[0] as string;
      const snippet = thread[1] as string;
      const threadTimestamp = thread[2] as number;
      const threadId = thread[3] as string;

      if (!threadId) continue;

      const threadMessages = thread[4] as unknown[][];
      if (!Array.isArray(threadMessages)) continue;

      const lastMsg = threadMessages[threadMessages.length - 1] as unknown[];
      if (!Array.isArray(lastMsg)) continue;

      const messageId = lastMsg[0] as string;
      if (!messageId) continue;

      const senderArr = lastMsg[1] as unknown[];
      const fromEmail = (senderArr?.[1] ?? '') as string;
      const fromName = (senderArr?.[2] ?? fromEmail.split('@')[0]) as string;

      const date = (lastMsg[7] ?? threadTimestamp) as number;
      const msgSnippet = (lastMsg[9] ?? snippet ?? '') as string;
      const labels = (lastMsg[10] ?? []) as string[];

      messages.push({
        threadId,
        messageId,
        subject: subject ?? '(no subject)',
        from: { email: fromEmail, name: fromName },
        date,
        snippet: msgSnippet,
        labels,
        unread: labels.includes('^u'),
        messageCount: threadMessages.length,
      });
    }
  }

  return { messages, totalCount: messages.length };
}
