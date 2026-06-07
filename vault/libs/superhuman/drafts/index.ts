/**
 * Superhuman Draft Operations
 *
 * List and create draft emails.
 */

import type {
  ListSnippetsInput,
  ListSnippetsOutput,
  CreateDraftInput,
  CreateDraftOutput,
  CreateReplyDraftInput,
  CreateReplyDraftOutput,
  DeleteDraftInput,
  DeleteDraftOutput,
  UpdateDraftInput,
  UpdateDraftOutput,
  SuperhumanAliasEntry,
  SuperhumanDraftModel,
  SuperhumanCachedThreadPresenter,
} from '../schemas';
import { getBackendHeaders } from '../helpers';
import { Unauthenticated, ContractDrift, NotFound, throwForStatus } from '@vallum/_runtime';

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

interface SuperhumanDraftEntry {
  id: string;
  thread: {
    historyId: number;
    messages: Record<
      string,
      {
        draft: {
          id: string;
          name?: string;
          subject?: string;
          body?: string;
          snippet?: string;
          clientCreatedAt?: string;
          date?: string;
          threadId?: string;
          from?: string;
          to?: string[];
          cc?: string[];
        };
      }
    >;
  };
}

interface SuperhumanDraftResponse {
  threadList?: SuperhumanDraftEntry[];
  nextOffset?: number;
}

/**
 * List Superhuman snippets (reusable email templates).
 * Uses Superhuman's backend API to fetch snippets.
 */
export async function listSnippets(
  opts: ListSnippetsInput,
): Promise<ListSnippetsOutput> {
  if (!window.Account) {
    throw new Unauthenticated(
      'Account object not found. User not logged into Superhuman. ' +
        'Navigate to mail.superhuman.com.',
    );
  }

  const account = window.Account;
  const email = account.emailAddress;
  const limit = opts.limit ?? 25;
  const offset = opts.offset ?? 0;

  // Call backend API to get drafts
  const payload = {
    filter: { type: 'snippet' },
    offset,
    limit,
  };

  const headers = await getBackendHeaders();
  const response = await fetch('/~backend/v3/userdata.getThreads', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throwForStatus(response.status, await response.text().catch(() => undefined));
  }

  const data: SuperhumanDraftResponse = await response.json();

  if (!data.threadList || data.threadList.length === 0) {
    return {
      account: email,
      snippets: [],
      total: 0,
    };
  }

  // Extract snippets from nested response structure
  const snippets = data.threadList.flatMap((entry) => {
    const messages = entry.thread.messages;
    return Object.values(messages).map((msg) => {
      const draft = msg.draft;
      return {
        id: draft.id,
        name: draft.name ?? '',
        subject: draft.subject ?? '',
        body: draft.body ?? '',
        snippet: draft.snippet ?? '',
        date: draft.clientCreatedAt ?? draft.date ?? new Date().toISOString(),
        threadId: draft.threadId ?? entry.id,
        from: draft.from ?? email,
        to: draft.to,
        cc: draft.cc,
      };
    });
  });

  return {
    account: email,
    snippets,
    total: snippets.length,
  };
}

/**
 * Create a new email draft in Superhuman.
 *
 * WHY THIS BYPASSES saveDraft():
 * Superhuman's normal draft flow is: initializeDraft → saveDraft → modifier queue.
 * saveDraft enqueues a SAVE_DRAFT modifier to an IndexedDB-backed queue. The modifier
 * has two phases: modify (applies in-memory, immediate) and persist (writes to backend
 * via writeUserDataMessage). The persist phase is processed by a background sync worker
 * that reads uncompleted modifiers from IDB.
 *
 * The problem: when executing via CDP, the persist phase never fires. The modifier gets
 * written to IDB and marked completed, but no backend write occurs (zero network calls
 * to userdata.writeMessage). The draft exists transiently in-memory (appears in listDrafts
 * for a moment) then disappears when the list refreshes from the server.
 *
 * The fix: use initializeDraft to build a properly-formatted draft model (it handles
 * rfc822Id generation, contact normalization, timestamps, schemaVersion, etc.), extract
 * JSON via draftModel.json(), convert to backend format via _appToBackendDraft(), then
 * write directly to the backend via writeUserDataMessage.
 *
 * After the backend write, we call presenter.deleteFromInMemory() to clean up the
 * in-memory thread cache. Without this cleanup, the modifier queue detects a pending
 * draft that was never saveDraft'd and shows a "sorry, failed to save draft" toast.
 *
 * Backend format requirements (discovered via comparison with existing drafts):
 * - action must be "compose" (not "new" which initializeDraft uses internally)
 * - null fields must be omitted (backend returns malformed-data 400)
 * - empty arrays must be omitted (cc, bcc, references when empty)
 * - lastSessionId must be a UUID string (not null)
 * - unread field must be present (boolean)
 * - write path: threads/{threadId}/messages/{draftId}/draft
 *   (writeUserDataMessage auto-prepends users/{userId}/)
 */
export async function createDraft(
  opts: CreateDraftInput,
): Promise<CreateDraftOutput> {
  if (!window.Account) {
    throw new Unauthenticated(
      'Account object not found. User not logged into Superhuman. ' +
        'Navigate to mail.superhuman.com.',
    );
  }

  const account = window.Account;
  const email = account.emailAddress;

  // Use initializeDraft to build a properly-structured draft model.
  // This handles rfc822Id, contact formatting, schemaVersion, etc.
  const operation = {
    watching: true,
    uniqueCallback: () => {},
    onUnwatch: () => {},
  };
  const presenter = account.threads.getNewDraftPresenter(operation);

  const toContacts = (addrs: string[]) =>
    addrs.map((a) => ({ email: a, name: a }));

  const draftModel = presenter.initializeDraft({
    to: toContacts(opts.to ?? []),
    cc: toContacts(opts.cc ?? []),
    bcc: toContacts(opts.bcc ?? []),
    subject: opts.subject ?? '',
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
  const draftId = draftModel.id;

  // Extract JSON and convert to backend format
  const draftJson = JSON.parse(JSON.stringify(draftModel.json()));
  draftJson.threadId = threadId;
  if (opts.from) {
    // Reflect alias override in the backend JSON payload
    const aliases = window.Account?.settings?._cache?.aliases?.list;
    let fromName = opts.from.split('@')[0];
    if (aliases) {
      const alias = aliases.find(
        (a: SuperhumanAliasEntry) => a.sendAs?.sendAsEmail === opts.from,
      );
      if (alias?.sendAs?.displayName) {
        fromName = alias.sendAs.displayName;
      }
    }
    draftJson.from = { email: opts.from, name: fromName };
  }
  account.backend._appToBackendDraft(draftJson);

  // Strip null fields and empty arrays (backend rejects them as malformed-data)
  for (const key of Object.keys(draftJson)) {
    const val = draftJson[key];
    if (val === null || (Array.isArray(val) && val.length === 0)) {
      delete draftJson[key];
    }
  }

  // Fix fields that initializeDraft sets differently from what the backend expects
  draftJson.action = 'compose';
  draftJson.unread = false;
  if (!draftJson.lastSessionId) {
    draftJson.lastSessionId = crypto.randomUUID();
  }

  // Write directly to Superhuman backend (bypasses broken modifier queue)
  await account.backend.writeUserDataMessage([
    {
      path: `threads/${threadId}/messages/${draftId}/draft`,
      value: draftJson,
    },
  ]);

  // Clean up in-memory state to prevent "failed to save draft" toast.
  // initializeDraft registers the presenter in the thread cache; without cleanup,
  // the app detects an orphaned draft and shows an error.
  presenter.deleteFromInMemory();

  return {
    success: true,
    id: draftId,
    threadId,
    account: email,
    subject:
      typeof draftModel.getSubject === 'function'
        ? draftModel.getSubject()
        : (opts.subject ?? ''),
  };
}

/**
 * Create a reply draft on an existing email thread.
 *
 * Same bypass as createDraft: createOrReplaceDraftAsync builds the reply model
 * (with quoted content, proper recipients, references/in-reply-to headers),
 * but saveDraft's persist phase never fires from CDP. So we extract the draft
 * JSON, convert to backend format, and write directly via writeUserDataMessage.
 */
export async function createReplyDraft(
  opts: CreateReplyDraftInput,
): Promise<CreateReplyDraftOutput> {
  if (!window.Account) {
    throw new Unauthenticated(
      'Account object not found. User not logged into Superhuman. ' +
        'Navigate to mail.superhuman.com.',
    );
  }

  const account = window.Account;
  const email = account.emailAddress;
  const cache = account.threads.identityMap.cache;
  const { threadId, body, action } = opts;

  // Find the thread presenter in cache
  const presenter = cache[threadId] as
    | SuperhumanCachedThreadPresenter
    | undefined;
  if (!presenter) {
    throw new NotFound(`Thread not found in cache: ${threadId}`);
  }

  // Ensure content is loaded (renders are needed for reply draft creation)
  if (!presenter.renders || Object.keys(presenter.renders).length === 0) {
    await presenter.loadContentAsync();
  }

  // Get the last non-draft message to reply to
  const messages = presenter.metadata?.messages;
  if (!messages || messages.length === 0) {
    throw new NotFound(`Thread ${threadId} has no messages. Cannot create reply.`);
  }
  const realMessages = messages.filter((m) => !m.id?.startsWith('draft'));
  if (realMessages.length === 0) {
    throw new NotFound(
      `Thread ${threadId} has no non-draft messages. Cannot create reply.`,
    );
  }
  const lastMessage = realMessages[realMessages.length - 1];

  // Create the reply draft model (builds quoted content, sets recipients, etc.)
  const draftModel = await presenter.createOrReplaceDraftAsync(
    lastMessage.id!,
    action,
  );

  if (!draftModel) {
    throw new ContractDrift(
      'createOrReplaceDraftAsync returned null. Internal API may have changed.',
    );
  }

  // Set body content on the draft model.
  // The reply model uses a direct .body property (not getBody/setBody methods).
  // quotedContent holds the reply quote separately, so body is just the new content.
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

  const draftId = draftModel.id;

  // Extract JSON and convert to backend format (same pattern as createDraft)
  const draftJson = JSON.parse(JSON.stringify(draftModel.json()));
  draftJson.threadId = threadId;
  if (opts.from) {
    const aliases = window.Account?.settings?._cache?.aliases?.list;
    let fromName = opts.from.split('@')[0];
    if (aliases) {
      const alias = aliases.find(
        (a: SuperhumanAliasEntry) => a.sendAs?.sendAsEmail === opts.from,
      );
      if (alias?.sendAs?.displayName) {
        fromName = alias.sendAs.displayName;
      }
    }
    draftJson.from = { email: opts.from, name: fromName };
  }
  account.backend._appToBackendDraft(draftJson);

  // Strip null fields and empty arrays (backend rejects them as malformed-data)
  for (const key of Object.keys(draftJson)) {
    const val = draftJson[key];
    if (val === null || (Array.isArray(val) && val.length === 0)) {
      delete draftJson[key];
    }
  }

  // Fix fields for backend compatibility
  draftJson.unread = false;
  if (!draftJson.lastSessionId) {
    draftJson.lastSessionId = crypto.randomUUID();
  }

  // Write directly to Superhuman backend (bypasses broken modifier queue)
  await account.backend.writeUserDataMessage([
    {
      path: `threads/${threadId}/messages/${draftId}/draft`,
      value: draftJson,
    },
  ]);

  // NOTE: Do NOT call deleteFromInMemory() here; unlike createDraft (where the
  // presenter is a throwaway from getNewDraftPresenter), this presenter is the
  // existing thread. Deleting it would remove the entire conversation from the UI.

  // Extract recipient info
  const toRecipients =
    typeof draftModel.getTo === 'function'
      ? draftModel
          .getTo()
          .map(
            (t: { email?: string; emailAddress?: string }) =>
              t.email ?? t.emailAddress ?? String(t),
          )
          .join(', ')
      : '';

  const subject =
    typeof draftModel.getSubject === 'function' ? draftModel.getSubject() : '';

  const draftAction =
    typeof draftModel.getAction === 'function'
      ? draftModel.getAction()
      : action;

  return {
    success: true,
    draftId,
    threadId,
    subject,
    to: toRecipients,
    action: draftAction,
    account: email,
  };
}

/**
 * Delete (discard) a draft email message.
 *
 * Uses Superhuman's discardDraft mechanism: writes a `discardedAt` timestamp
 * to the draft's backend path via writeUserDataMessage. This is the same
 * mechanism triggered by Cmd+Shift+. in the Superhuman UI.
 *
 * Works for both standalone drafts (new compositions) and reply drafts
 * on existing threads.
 */
export async function deleteDraft(
  opts: DeleteDraftInput,
): Promise<DeleteDraftOutput> {
  if (!window.Account) {
    throw new Unauthenticated(
      'Account object not found. User not logged into Superhuman. ' +
        'Navigate to mail.superhuman.com.',
    );
  }

  const account = window.Account;
  const email = account.emailAddress;
  const { threadId, draftId } = opts;

  // Write discardedAt timestamp to the backend (same as Superhuman's discard modifier)
  await account.backend.writeUserDataMessage([
    {
      path: `threads/${threadId}/messages/${draftId}/discardedAt`,
      value: Date.now(),
    },
  ]);

  // Clean up in-memory state if the thread is a standalone draft
  // For reply drafts, do NOT call deleteFromInMemory; it would remove the whole thread
  if (threadId.startsWith('draft')) {
    const cache = account.threads.identityMap.cache;
    const presenter = cache[threadId];
    if (presenter && 'deleteFromInMemory' in presenter) {
      (presenter as { deleteFromInMemory: () => void }).deleteFromInMemory();
    }
  }

  return {
    success: true,
    threadId,
    draftId,
    account: email,
  };
}

/**
 * Update an existing draft email's recipients, body, or subject.
 *
 * Reads the current draft from the backend, applies the requested changes,
 * then writes the updated draft back via writeUserDataMessage.
 *
 * Works for both standalone drafts and reply drafts on existing threads.
 */
export async function updateDraft(
  opts: UpdateDraftInput,
): Promise<UpdateDraftOutput> {
  if (!window.Account) {
    throw new Unauthenticated(
      'Account object not found. User not logged into Superhuman. ' +
        'Navigate to mail.superhuman.com.',
    );
  }

  const account = window.Account;
  const email = account.emailAddress;
  const { threadId, draftId } = opts;

  // Fetch the current draft from backend to get its current state
  const headers = await getBackendHeaders();
  const payload = {
    filter: { type: 'draft' },
    offset: 0,
    limit: 100,
  };

  const response = await fetch('/~backend/v3/userdata.getThreads', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throwForStatus(response.status, await response.text().catch(() => undefined));
  }

  const data = (await response.json()) as SuperhumanDraftResponse;

  // Find the specific draft
  let currentDraft: Record<string, unknown> | null = null;
  if (data.threadList) {
    for (const entry of data.threadList) {
      if (entry.id === threadId) {
        const messages = entry.thread.messages;
        const draftMsg = messages[draftId];
        if (draftMsg) {
          currentDraft = draftMsg.draft as Record<string, unknown>;
        }
        break;
      }
    }
  }

  if (!currentDraft) {
    throw new NotFound(
      `Draft not found: threadId=${threadId}, draftId=${draftId}. ` +
        'Use listDrafts or readEmail to find draft IDs.',
    );
  }

  // Apply updates
  const updatedDraft = { ...currentDraft };

  if (opts.to !== undefined) {
    updatedDraft.to = opts.to.map((addr) => ({ email: addr, name: addr }));
  }
  if (opts.cc !== undefined) {
    updatedDraft.cc = opts.cc.map((addr) => ({ email: addr, name: addr }));
  }
  if (opts.bcc !== undefined) {
    updatedDraft.bcc = opts.bcc.map((addr) => ({ email: addr, name: addr }));
  }
  if (opts.subject !== undefined) {
    updatedDraft.subject = opts.subject;
  }
  if (opts.body !== undefined) {
    updatedDraft.body = opts.body;
  }

  // Update lastSessionId to mark this as a new edit
  updatedDraft.lastSessionId = crypto.randomUUID();

  // Strip null fields and empty arrays (backend rejects them as malformed-data)
  for (const key of Object.keys(updatedDraft)) {
    const val = updatedDraft[key];
    if (val === null || (Array.isArray(val) && val.length === 0)) {
      delete updatedDraft[key];
    }
  }

  // Write updated draft back to backend
  await account.backend.writeUserDataMessage([
    {
      path: `threads/${threadId}/messages/${draftId}/draft`,
      value: updatedDraft,
    },
  ]);

  return {
    success: true,
    threadId,
    draftId,
    account: email,
    subject: (updatedDraft.subject as string) ?? '',
  };
}
