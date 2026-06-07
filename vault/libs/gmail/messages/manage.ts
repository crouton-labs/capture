/**
 * Gmail Message Management Operations
 *
 * Delete, archive, and manage emails.
 */

import type { GmailGlobals, DeleteEmailOutput } from '../schemas';

import { gmailFetch } from '../helpers';

import { ContractDrift, NotFound } from '@vallum/_runtime';

/**
 * Delete an email thread (moves to trash by default).
 */
export async function deleteEmail(opts: {
  xsrf: string;
  account: number;
  globals: GmailGlobals;
  threadId: string;
  permanent?: boolean;
}): Promise<DeleteEmailOutput> {
  const { xsrf, account, globals, threadId } = opts;
  const permanent = opts.permanent ?? false;
  const timestamp = Date.now();

  // First fetch thread to get all message IDs
  const fetchPayload = threadId.startsWith('thread-a:r')
    ? [[[threadId, null, null]], 2]
    : [[[threadId, 1, null, null, 1]], 2];

  const data = await gmailFetch<unknown[]>(
    xsrf,
    account,
    globals,
    '/i/fd?hl=en&c=1&rt=r&pt=ji',
    fetchPayload,
  );

  if (!data[1] || !data[1][0]) {
    throw new NotFound('Thread not found');
  }

  const threadData = data[1][0] as unknown[];
  const messageIds: string[] = [];

  // Extract message IDs from metadata
  const threadInfo = threadData[1] as unknown[];
  if (threadInfo && threadInfo[1]) {
    const messagesArr = Array.isArray((threadInfo[1] as unknown[])[0])
      ? (threadInfo[1] as unknown[][])
      : [threadInfo[1] as unknown[]];
    for (const msg of messagesArr) {
      if (
        msg &&
        msg[0] &&
        typeof msg[0] === 'string' &&
        (msg[0] as string).startsWith('msg-')
      ) {
        messageIds.push(msg[0] as string);
      }
    }
  }

  // Also check bodies array
  if (threadData[2] && Array.isArray(threadData[2])) {
    for (const msg of threadData[2] as unknown[][]) {
      if (
        msg &&
        msg[0] &&
        typeof msg[0] === 'string' &&
        (msg[0] as string).startsWith('msg-')
      ) {
        if (!messageIds.includes(msg[0] as string)) {
          messageIds.push(msg[0] as string);
        }
      }
    }
  }

  if (messageIds.length === 0) {
    throw new ContractDrift('No messages found in thread');
  }

  // Delete with labels: ^k = trash, ^x = permanent
  const labelsToAdd = permanent ? ['^k', '^x'] : ['^k'];
  const labelsToRemove = ['^i', '^all'];

  const deletePayload = [
    null,
    [
      [
        [
          6,
          [
            threadId,
            [
              null,
              null,
              null,
              null,
              null,
              null,
              [labelsToAdd, labelsToRemove, messageIds, timestamp],
            ],
          ],
        ],
      ],
    ],
    null,
    [timestamp, 1, timestamp, 1, 1],
    2,
  ];

  await gmailFetch(
    xsrf,
    account,
    globals,
    '/i/s?hl=en&c=2&rt=r&pt=ji',
    deletePayload,
  );

  return {
    success: true,
    threadId,
    messageIds,
    messageCount: messageIds.length,
    permanent,
  };
}
