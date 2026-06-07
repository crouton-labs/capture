/**
 * Superhuman AI Operations
 *
 * Interact with Superhuman's AI assistant.
 */

import type {
  AskAIInput,
  AskAIOutput,
  SuperhumanMessage,
  SuperhumanThreadPresenter,
} from '../schemas';
import { Unauthenticated, throwForStatus } from '@vallum/_runtime';

interface AICredential {
  getIDTokenAsync: () => Promise<string>;
  user?: {
    providerId?: string;
  };
}

interface SuperhumanWindow {
  version?: string;
}

interface ThreadMessage {
  id: string;
  from: string;
  to: string[];
  subject: string;
  date: string;
  snippet: string;
  body: string;
}

/**
 * Send a prompt to Superhuman AI and return the response.
 * Calls the askAIProxy endpoint and reads the full SSE stream.
 */
export async function askAI(args: AskAIInput): Promise<AskAIOutput> {
  if (!window.Account) {
    throw new Unauthenticated(
      'Account object not found. User not logged into Superhuman.',
    );
  }

  const account = window.Account;
  const email = account.emailAddress;

  const credential = account.credential as unknown as AICredential;
  if (!credential || typeof credential.getIDTokenAsync !== 'function') {
    throw new Unauthenticated('Cannot access Superhuman credentials for AI endpoint.');
  }
  const idToken = await credential.getIDTokenAsync();

  const deviceId = localStorage.getItem('deviceId');
  if (!deviceId) {
    throw new Unauthenticated(
      'Device ID not found in localStorage. Superhuman not properly initialized.',
    );
  }

  const superhumanWindow = window as unknown as {
    Superhuman?: SuperhumanWindow;
  };
  const version =
    superhumanWindow.Superhuman?.version ||
    localStorage.getItem('lastCodeVersion');
  if (!version) {
    throw new Unauthenticated(
      'Superhuman version not found. Cannot authenticate AI request.',
    );
  }

  const sessionId = args.sessionId ? args.sessionId : crypto.randomUUID();
  const requestId = crypto.randomUUID();
  // Superhuman ExternalIDs use base62 with alphabet: 0-9, a-z, A-Z (lowercase first)
  const b62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  function encodeBase62(n: number, len: number): string {
    let result = '';
    let val = n;
    while (val > 0) {
      result = b62[val % 62] + result;
      val = Math.floor(val / 62);
    }
    while (result.length < len) result = '0' + result;
    return result;
  }
  const tsSec = Math.floor(Date.now() / 1000);
  const tsEncoded = encodeBase62(tsSec, 6);
  // Shard key (4 chars) + entropy (7 chars)
  const randomBytes = new Uint8Array(11);
  crypto.getRandomValues(randomBytes);
  const suffix = Array.from(randomBytes)
    .map((b) => b62[b % 62])
    .join('');
  const eventId = 'event_1' + tsEncoded + suffix;

  const user = {
    provider_id: credential.user?.providerId ? credential.user.providerId : '',
    email,
    name: account.user?._name ? account.user._name : email.split('@')[0],
  };

  let currentThreadId: string | null = null;
  let currentThreadMessages: ThreadMessage[] = [];

  if (args.threadId) {
    currentThreadId = args.threadId;
    const threadPresenter =
      account.threads?.identityMap?.cache?.[args.threadId];
    const threadPresenterWithModel =
      threadPresenter && '_threadModel' in threadPresenter
        ? (threadPresenter as SuperhumanThreadPresenter)
        : null;
    if (threadPresenterWithModel?._threadModel?.messages) {
      currentThreadMessages =
        threadPresenterWithModel._threadModel.messages.map(
          (msg: SuperhumanMessage) => {
            const msgId = msg.id ? msg.id : '';
            const msgFrom = msg.from?.email ? msg.from.email : '';
            const msgTo = msg.to
              ? msg.to.map((t) => (t.email ? t.email : ''))
              : [];
            const msgSubject = threadPresenterWithModel._threadModel.subject
              ? threadPresenterWithModel._threadModel.subject
              : '';
            const msgDate =
              msg.date instanceof Date
                ? msg.date.toISOString()
                : typeof msg.date === 'number'
                  ? new Date(msg.date).toISOString()
                  : '';
            const msgSnippet = msg.snippet ? msg.snippet : '';
            const msgBody = msg.body ? msg.body : msgSnippet;

            return {
              id: msgId,
              from: msgFrom,
              to: msgTo,
              subject: msgSubject,
              date: msgDate,
              snippet: msgSnippet,
              body: msgBody,
            };
          },
        );
    }
  }

  const body = {
    session_id: sessionId,
    question_event_id: eventId,
    query: args.query,
    chat_history: args.chatHistory || [],
    user,
    local_datetime: new Date().toISOString(),
    current_thread_id: currentThreadId,
    current_thread_messages: currentThreadMessages,
    available_skills: [
      'filter',
      'schedule',
      'multiMessage',
      'draft',
      'displayThoughts',
    ],
  };

  const response = await fetch(
    'https://mail.superhuman.com/~backend/v3/ai.askAIProxy',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: `Bearer ${idToken}`,
        'x-superhuman-user-email': email,
        'x-superhuman-device-id': deviceId,
        'x-superhuman-session-id': sessionId,
        'x-superhuman-request-id': requestId,
        'x-superhuman-version': version,
      },
      credentials: 'include',
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    throwForStatus(response.status, await response.text().catch(() => undefined));
  }

  // Read SSE stream to completion
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let finalContent = '';
  let responseEventId = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const data = JSON.parse(line.slice(6));
        if (data.content) {
          finalContent = data.content; // cumulative
        }
        if (data.event_id) {
          responseEventId = data.event_id;
        }
      } catch {
        // skip unparseable lines
      }
    }
  }

  // Strip <thinking>...</thinking> tags from final content
  const cleaned = finalContent
    .replace(/<thinking>[\s\S]*?<\/thinking>\s*/g, '')
    .trim();

  return {
    response: cleaned,
    rawResponse: finalContent,
    sessionId,
    eventId: responseEventId,
    account: email,
  };
}
