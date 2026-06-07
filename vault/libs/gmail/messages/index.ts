/**
 * Gmail Message Read Operations
 *
 * List, search, and read email messages.
 */

import type {
  GmailGlobals,
  MessageContent,
  ListInboxOutput,
  SearchEmailsOutput,
  ReadEmailOutput,
} from '../schemas';

import { ContractDrift } from '@vallum/_runtime';

import {
  gmailFetch,
  htmlToText,
  parseListResponse,
  parseSearchResponse,
} from '../helpers';

// Re-export send and manage operations
export { sendEmail, replyEmail, forwardEmail } from './send';
export { deleteEmail } from './manage';

// Map scope names to Gmail system labels (null = no prefix, like Gmail's main search bar)
const SCOPE_TO_LABEL: Record<string, string | null> = {
  all: null, // No prefix - searches everything like Gmail's search bar
  inbox: '^i',
  sent: '^s',
  drafts: '^r',
  trash: '^k',
};

/**
 * List messages from Gmail inbox.
 */
export async function listInbox(opts: {
  xsrf: string;
  account: number;
  globals: GmailGlobals;
  count?: number;
  page?: number;
  viewType?: number;
}): Promise<ListInboxOutput> {
  const { xsrf, account, globals } = opts;
  const count = opts.count ?? 20;
  const page = opts.page ?? 0;
  const viewType = opts.viewType ?? 49;
  const timestamp = Date.now();

  const query = 'in:inbox';

  const payload = [
    [
      viewType,
      count,
      null,
      query,
      [null, null, null, null, 0],
      `itemlist-ViewType(${viewType})-${account}`,
      account,
      count,
      null,
      page,
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
    '/i/bv?hl=en&c=16&rt=r&pt=ji',
    payload,
  );

  return parseListResponse(data);
}

/**
 * Search Gmail using Gmail search query syntax.
 */
export async function searchEmails(opts: {
  xsrf: string;
  account: number;
  globals: GmailGlobals;
  query: string;
  scope?: 'all' | 'inbox' | 'sent' | 'drafts' | 'trash';
  limit?: number;
}): Promise<SearchEmailsOutput> {
  const { xsrf, account, globals, query } = opts;
  const scope = opts.scope ?? 'all';
  const limit = Math.min(opts.limit ?? 50, 50);
  const timestamp = Date.now();

  // Format query with scope - only add prefix for specific folders, not 'all'
  const scopeLabel = SCOPE_TO_LABEL[scope];
  const formattedQuery = scopeLabel ? `in:${scopeLabel} ${query}` : query;

  const uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16).toUpperCase();
  });

  const searchOptions = [
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
    timestamp,
    -28800000,
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
    0,
    0,
    0,
    0,
  ];

  const searchMetadata = [
    1,
    0,
    0,
    null,
    null,
    null,
    1,
    uuid,
    null,
    1,
    null,
    null,
    1,
    null,
    1,
    null,
    null,
    null,
    null,
    null,
    0,
  ];

  const payload = [
    [
      123, // Search viewType
      50,
      null,
      formattedQuery,
      searchOptions,
      `itemlist-ViewType(123)-0`,
      account,
      50,
      null,
      0,
      null,
      null,
      null,
      1,
      null,
      searchMetadata,
      null,
      null,
      1,
      null,
      null,
      0,
      1,
      0,
      [[[2, 50]]],
      0,
      0,
      null,
      null,
      null,
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

  const result = parseSearchResponse(data);
  result.messages = result.messages.slice(0, limit);
  result.totalCount = result.messages.length;
  return result;
}

/**
 * Read full email content from a thread.
 */
export async function readEmail(opts: {
  xsrf: string;
  account: number;
  globals: GmailGlobals;
  threadId: string;
}): Promise<ReadEmailOutput> {
  const { xsrf, account, globals, threadId } = opts;

  // Different payload for sent vs received threads
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
    throw new ContractDrift('Invalid thread response structure');
  }

  const threadData = data[1][0] as unknown[];
  const messages: MessageContent[] = [];

  if (threadId.startsWith('thread-a:r')) {
    // Sent message format
    if (threadData[2] && Array.isArray(threadData[2])) {
      for (const msgEntry of threadData[2] as unknown[][]) {
        if (!msgEntry || !msgEntry[0]) continue;
        const msgId = msgEntry[0] as string;
        const msgData = msgEntry[1] as unknown[];
        if (!msgData) continue;

        const toArray = (msgData[0] || []) as unknown[][];
        const ccArray = (msgData[1] || []) as unknown[][];
        const subject = (msgData[4] || '') as string;
        const bodyStruct = msgData[5] as unknown[];
        const snippet = (msgData[6] || '') as string;
        const msgTimestamp = (msgData[20] || Date.now()) as number;

        let bodyHtml = '';
        if (bodyStruct && bodyStruct[1] && Array.isArray(bodyStruct[1])) {
          for (const part of bodyStruct[1] as unknown[][]) {
            if (part && part[2] && (part[2] as unknown[])[1]) {
              bodyHtml += (part[2] as unknown[])[1];
            }
          }
        }

        // Count attachments at position [13]
        let attachmentCount = 0;
        if (msgData[13] && Array.isArray(msgData[13])) {
          for (const att of msgData[13] as unknown[][]) {
            if (att && att[0] && (att[0] as unknown[])[3]) {
              attachmentCount++;
            }
          }
        }

        messages.push({
          messageId: msgId,
          from: { email: globals.g10, name: globals.g10.split('@')[0] },
          to: toArray.map((r) => ({
            email: (r[1] || '') as string,
            name: (r[2] || r[1] || '') as string,
          })),
          cc: ccArray.map((r) => ({
            email: (r[1] || '') as string,
            name: (r[2] || r[1] || '') as string,
          })),
          subject,
          body: htmlToText(bodyHtml) || snippet,
          bodyHtml,
          date: msgTimestamp,
          snippet,
          attachmentCount,
        });
      }
    }
  } else {
    // Received message format
    const threadInfo = threadData[1] as unknown[];
    if (threadInfo && threadInfo[1]) {
      const metaArray = Array.isArray((threadInfo[1] as unknown[])[0])
        ? (threadInfo[1] as unknown[][])
        : [threadInfo[1] as unknown[]];
      const bodyArray = (threadData[2] || []) as unknown[][];

      for (const meta of metaArray) {
        if (!meta || !meta[0] || !(meta[0] as string).startsWith('msg-'))
          continue;
        const msgId = meta[0] as string;
        const sender = (meta[1] || []) as unknown[];
        const msgTimestamp = meta[2] as number;
        const labels = (meta[3] || []) as string[];
        const snippet = (meta[10] || '') as string;
        const subject = threadInfo[0]
          ? ((threadInfo[0] as unknown[])[1] as string)
          : '';

        const body = bodyArray.find((b) => b && b[0] === msgId);
        let toArray: unknown[][] = [];
        let ccArray: unknown[][] = [];
        let bodyHtml = '';

        if (body && body[1]) {
          const bodyData = body[1] as unknown[];
          if (Array.isArray(bodyData[0])) {
            toArray = bodyData[0] as unknown[][];
          }
          if (Array.isArray(bodyData[1])) {
            ccArray = bodyData[1] as unknown[][];
          }
          if (
            bodyData[5] &&
            (bodyData[5] as unknown[])[1] &&
            Array.isArray((bodyData[5] as unknown[])[1])
          ) {
            for (const part of (bodyData[5] as unknown[])[1] as unknown[][]) {
              if (part && part[2] && (part[2] as unknown[])[1]) {
                bodyHtml += (part[2] as unknown[])[1];
              }
            }
          }
        }

        // Count attachments at position [13]
        let attachmentCount = 0;
        if (body && body[1]) {
          const bd = body[1] as unknown[];
          if (bd[13] && Array.isArray(bd[13])) {
            for (const att of bd[13] as unknown[][]) {
              if (att && att[0] && (att[0] as unknown[])[3]) {
                attachmentCount++;
              }
            }
          }
        }

        messages.push({
          messageId: msgId,
          from: {
            email: (sender[1] || '') as string,
            name: (sender[2] || sender[1] || '') as string,
          },
          to: toArray.map((r) => ({
            email: (r[1] || '') as string,
            name: (r[2] || r[1] || '') as string,
          })),
          cc: ccArray.map((r) => ({
            email: (r[1] || '') as string,
            name: (r[2] || r[1] || '') as string,
          })),
          subject,
          body: htmlToText(bodyHtml),
          bodyHtml,
          date: msgTimestamp,
          labels,
          snippet,
          attachmentCount,
        });
      }
    }
  }

  if (messages.length === 0) {
    throw new ContractDrift(
      `No messages parsed from thread ${threadId}. The thread ID may belong to a different account; re-run getContext() after navigating to the correct account.`,
    );
  }

  return {
    threadId,
    messageCount: messages.length,
    messages,
  };
}
