/**
 * Gmail Attachment Operations
 *
 * List and upload attachments.
 */

import type {
  GmailGlobals,
  ListAttachmentsOutput,
  UploadAttachmentOutput,
  Attachment,
} from '../schemas';

import { gmailFetch } from '../helpers';

import { Validation, ContractDrift, NotFound, throwForStatus } from '@vallum/_runtime';

/**
 * List attachments from an email thread.
 */
export async function listAttachments(opts: {
  xsrf: string;
  account: number;
  globals: GmailGlobals;
  threadId: string;
}): Promise<ListAttachmentsOutput> {
  const { xsrf, account, globals, threadId } = opts;

  // Fetch thread
  const fetchPayload = threadId.startsWith('thread-a:r')
    ? [[[threadId, null, null]], 2]
    : [[[threadId, 1, null, null, 1]], 2];

  const fetchData = await gmailFetch<unknown[]>(
    xsrf,
    account,
    globals,
    '/i/fd?hl=en&c=1&rt=r&pt=ji',
    fetchPayload,
  );

  if (!fetchData[1] || !fetchData[1][0]) {
    throw new NotFound('Thread not found');
  }

  const threadData = fetchData[1][0] as unknown[];
  const messagesBodies = threadData[2] as unknown[][];

  if (!messagesBodies || !Array.isArray(messagesBodies)) {
    return { threadId, attachments: [] };
  }

  const attachments: Attachment[] = [];

  for (const body of messagesBodies) {
    if (!body || !body[1]) continue;

    const bodyData = body[1] as unknown[];
    const msgId = body[0] as string;

    // Attachments at position [13]
    if (bodyData[13] && Array.isArray(bodyData[13])) {
      for (const att of bodyData[13] as unknown[][]) {
        if (!att || !att[0] || !(att[0] as unknown[])[3]) continue;

        const attInfo = (att[0] as unknown[])[3] as unknown[];
        const url = attInfo[1] as string;
        const filename = attInfo[2] as string;
        const mimeType = attInfo[3] as string;
        const size = attInfo[4] as number;

        if (url && filename) {
          attachments.push({
            messageId: msgId,
            filename,
            mimeType,
            size,
            url,
          });
        }
      }
    }
  }

  return { threadId, attachments };
}

/**
 * Upload a file to Gmail for attachment.
 */
export async function uploadAttachment(opts: {
  account: number;
  messageId: string;
  fileName: string;
  mimeType: string;
  base64Data: string;
}): Promise<UploadAttachmentOutput> {
  const { account, messageId, fileName, mimeType, base64Data } = opts;

  // Validate base64Data before attempting upload
  if (
    !base64Data ||
    typeof base64Data !== 'string' ||
    base64Data.length === 0
  ) {
    throw new Validation(
      `base64Data is ${base64Data === undefined ? 'undefined' : base64Data === null ? 'null' : 'empty'}. ` +
        'The file content was not loaded correctly. ' +
        'If you built the file in bash, you cannot read it from a browser executor (they have separate filesystems). ' +
        'Either pass the base64 string directly into executeJS, or use the files library (searchDocs("files")) to save/load via device storage.',
    );
  }

  // Catch common encoding failures where "undefined" or "null" gets base64-encoded
  const decodedSize = Math.floor((base64Data.length * 3) / 4);
  if (decodedSize <= 20) {
    const preview = atob(base64Data);
    if (
      preview === 'undefined' ||
      preview === 'null' ||
      preview === '[object Object]'
    ) {
      throw new Validation(
        `base64Data decodes to "${preview}" (${decodedSize} bytes): the file content was not loaded correctly. ` +
          'This usually means the source returned undefined/null instead of actual file data. ' +
          'Check that downloadCSV returned content, or base64-encode the file in bash and pass the string directly.',
      );
    }
  }

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
    body: JSON.stringify([messageId]),
    credentials: 'include',
  });

  if (!initResponse.ok) {
    throwForStatus(initResponse.status, 'Upload init failed');
  }

  // Get upload URL from response headers
  const uploadUrl = initResponse.headers.get('x-goog-upload-url');
  if (!uploadUrl) {
    throw new ContractDrift('No upload URL in response');
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
    throwForStatus(uploadResponse.status, 'Upload failed');
  }

  // Get blob reference from response
  const blobRef = await uploadResponse.text();

  return {
    blobRef,
    attachmentId,
    fileName,
    mimeType,
    size: fileSize,
  };
}
