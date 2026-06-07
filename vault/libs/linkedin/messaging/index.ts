/**
 * LinkedIn Messaging Operations
 *
 * Conversations, messages, and messaging state management.
 */

import type {
  ListConversationsOutput,
  ViewConversationOutput,
  GetConversationWithUserOutput,
  SendMessageOutput,
  CreateGroupChatOutput,
  RenameGroupChatOutput,
  GetComposeOptionsOutput,
  EditMessageOutput,
  DeleteMessageOutput,
  ReactToMessageOutput,
  UnreactToMessageOutput,
  DownloadAttachmentOutput,
} from '../schemas';
import { getContext } from '../context';
import {
  linkedinFetch,
  getMessagingQueryId,
  generateUuid,
  generateTrackingId,
  resolveVanityNameToMemberId,
} from '../helpers';
import { Validation, ContractDrift, NotFound, UpstreamError, throwForStatus } from '@vallum/_runtime';

function epochToIso(ms: number | undefined): string | undefined {
  return ms != null ? new Date(ms).toISOString() : undefined;
}

interface ParticipantElement {
  entityUrn?: string;
  participantType?: {
    member?: {
      firstName?: { text?: string };
      lastName?: { text?: string };
      headline?: { text?: string };
      profileUrl?: string;
    };
  };
}

interface MessageElement {
  body?: { text?: string };
  actor?: {
    entityUrn?: string;
    '*actor'?: string;
    participantType?: {
      member?: {
        firstName?: { text?: string };
        lastName?: { text?: string };
      };
    };
  };
  '*actor'?: string;
  '*sender'?: string;
}

interface ConversationElement {
  entityUrn?: string;
  title?: string;
  groupChat?: boolean;
  unreadCount?: number;
  lastActivityAt?: number;
  '*conversationParticipants'?: string[];
  conversationParticipants?: ParticipantElement[];
  '*lastMessage'?: string;
  lastMessage?: MessageElement;
  messages?: {
    '*elements'?: string[];
  };
}

function parseConversationElement(
  e: ConversationElement,
  memberId: string,
  entityMap: Map<
    string,
    ConversationElement | ParticipantElement | MessageElement
  >,
): {
  conversationUrn: string;
  title?: string;
  groupChat: boolean;
  unreadCount: number;
  lastActivityAt?: number;
  participants: Array<{
    name: string;
    headline?: string;
    profileUrl?: string;
    memberId?: string;
  }>;
  lastMessage?: string;
  lastMessageSender?: string;
} | null {
  if (!e.entityUrn) return null;

  const participants: Array<{
    name: string;
    headline?: string;
    profileUrl?: string;
    memberId?: string;
  }> = [];

  // Resolve participant references if needed
  const participantRefs = e['*conversationParticipants'];
  const resolvedParticipants: ParticipantElement[] = participantRefs
    ? participantRefs
        .map((ref) => entityMap.get(ref) as ParticipantElement)
        .filter(Boolean)
    : e.conversationParticipants
      ? e.conversationParticipants
      : [];

  for (const participant of resolvedParticipants) {
    const member = participant?.participantType?.member;
    if (!member) continue;

    const name = [member.firstName?.text, member.lastName?.text]
      .filter(Boolean)
      .join(' ');
    if (!name) continue;
    if (participant.entityUrn?.includes(memberId)) continue;

    const participantMemberId = participant.entityUrn?.split(':').pop();
    participants.push({
      name,
      headline: member.headline?.text,
      profileUrl: member.profileUrl,
      memberId: participantMemberId,
    });
  }

  // Resolve last message: try *lastMessage ref, inline lastMessage, or messages.*elements[0]
  const lastMsgRef = e['*lastMessage'];
  let lastMsg: MessageElement | undefined = lastMsgRef
    ? (entityMap.get(lastMsgRef) as MessageElement | undefined)
    : e.lastMessage;

  if (!lastMsg) {
    const msgRefs = e.messages?.['*elements'];
    if (msgRefs && msgRefs.length > 0) {
      lastMsg = entityMap.get(msgRefs[0]) as MessageElement | undefined;
    }
  }

  let lastMessageSender: string | undefined;
  if (lastMsg) {
    // Resolve actor: check inline actor, *actor ref, or *sender ref
    const actorRef =
      lastMsg.actor?.['*actor'] ?? lastMsg['*actor'] ?? lastMsg['*sender'];
    const resolvedActor = actorRef
      ? (entityMap.get(actorRef) as ParticipantElement)
      : lastMsg.actor
        ? (lastMsg.actor as unknown as ParticipantElement)
        : undefined;

    const senderMember = resolvedActor?.participantType?.member;
    if (senderMember) {
      const senderName = [
        senderMember.firstName?.text,
        senderMember.lastName?.text,
      ]
        .filter(Boolean)
        .join(' ');
      if (senderName) {
        lastMessageSender = senderName;
      }
    }
  }

  return {
    conversationUrn: e.entityUrn,
    title: e.title ?? undefined,
    groupChat: e.groupChat ?? false,
    unreadCount: e.unreadCount ?? 0,
    lastActivityAt: e.lastActivityAt,
    participants,
    lastMessage: lastMsg?.body?.text,
    lastMessageSender,
  };
}

interface ConversationsResponse {
  data?: {
    data?: {
      messengerConversationsByCategoryQuery?: {
        '*elements'?: string[];
        elements?: ConversationElement[];
        metadata?: {
          nextCursor?: string;
        };
      };
    };
  };
  included?: Array<
    (ConversationElement | ParticipantElement | MessageElement) & {
      $type?: string;
      entityUrn?: string;
    }
  >;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = () => 500 + Math.floor(Math.random() * 1000);
const MAX_CONVERSATIONS_PER_PAGE = 25;

type RawConversation = {
  conversationUrn: string;
  title?: string;
  groupChat: boolean;
  unreadCount: number;
  lastActivityAt?: number;
  participants: Array<{
    name: string;
    headline?: string;
    profileUrl?: string;
    memberId?: string;
  }>;
  lastMessage?: string;
  lastMessageSender?: string;
};

/**
 * Parse a single page of conversation data from the category query response.
 */
function parseConversationsPage(
  resp: ConversationsResponse,
  memberId: string,
): {
  conversations: RawConversation[];
  nextCursor?: string;
} {
  const convData = resp.data?.data?.messengerConversationsByCategoryQuery;

  if (!convData) {
    return { conversations: [] };
  }

  // Build entity map from included array for reference resolution
  const entityMap = new Map<
    string,
    ConversationElement | ParticipantElement | MessageElement
  >();
  if (resp.included) {
    for (const entity of resp.included) {
      if (entity.entityUrn) {
        entityMap.set(entity.entityUrn, entity);
      }
    }
  }

  // Get elements - resolve references if needed
  const elements: ConversationElement[] = [];
  const elementRefs = convData['*elements'];
  if (elementRefs) {
    for (const ref of elementRefs) {
      const entity = entityMap.get(ref) as ConversationElement | undefined;
      if (entity) elements.push(entity);
    }
  } else if (convData.elements) {
    elements.push(...convData.elements);
  }

  // Parse each conversation element
  const conversations: RawConversation[] = [];
  for (const e of elements) {
    const parsed = parseConversationElement(e, memberId, entityMap);
    if (parsed) {
      conversations.push(parsed);
    }
  }

  return {
    conversations,
    nextCursor: convData.metadata?.nextCursor,
  };
}

export async function listConversations(opts: {
  csrf?: string;
  memberId?: string;
  count?: number;
}): Promise<ListConversationsOutput> {
  // Auto-fetch context if csrf or memberId not provided
  let csrf = opts.csrf;
  let memberId = opts.memberId;
  if (!csrf || !memberId) {
    const ctx = await getContext();
    csrf = csrf || ctx.csrf;
    memberId = memberId || ctx.memberId;
  }

  const count = Math.max(opts.count ?? 20, 1);
  const mailboxUrnEncoded = encodeURIComponent(
    `urn:li:fsd_profile:${memberId}`,
  );

  const queryId = getMessagingQueryId(
    'messengerConversationsByCategoryQuery',
    'find-conversations-by-category-v2',
  );

  const allConversations: RawConversation[] = [];
  const seenUrns = new Set<string>();
  let nextCursor: string | undefined;
  let pagesLoaded = 0;

  while (allConversations.length < count) {
    const pageSize = Math.min(
      MAX_CONVERSATIONS_PER_PAGE,
      count - allConversations.length,
    );

    let vars = `(query:(predicateUnions:List((conversationCategoryPredicate:(category:INBOX)))),count:${pageSize},mailboxUrn:${mailboxUrnEncoded}`;
    if (nextCursor) {
      vars += `,nextCursor:${encodeURIComponent(nextCursor)}`;
    }
    vars += ')';

    const resp = await linkedinFetch<ConversationsResponse>(
      csrf,
      `/voyager/api/voyagerMessagingGraphQL/graphql?queryId=${queryId}&variables=${vars}`,
    );

    const page = parseConversationsPage(resp, memberId);
    pagesLoaded++;

    if (page.conversations.length === 0) break;

    // Deduplicate by conversationUrn
    for (const conv of page.conversations) {
      if (!seenUrns.has(conv.conversationUrn)) {
        seenUrns.add(conv.conversationUrn);
        allConversations.push(conv);
      }
    }

    nextCursor = page.nextCursor;
    if (!nextCursor) break;
    if (allConversations.length >= count) break;

    // Rate limiting between pages
    await sleep(jitter());
  }

  // Sort by last activity descending
  allConversations.sort(
    (a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0),
  );

  return {
    conversations: allConversations.slice(0, count).map((c) => ({
      ...c,
      lastActivityAt: epochToIso(c.lastActivityAt),
    })),
    pagesLoaded,
  };
}

interface RenderContentItem {
  file?: {
    assetUrn?: string;
    byteSize?: number;
    name?: string;
    mediaType?: string;
    url?: string;
  };
  vectorImage?: {
    digitalmediaAsset?: string;
    rootUrl?: string;
    artifacts?: Array<{
      width?: number;
      height?: number;
      fileIdentifyingUrlPathSegment?: string;
    }>;
  };
}

interface GraphQLMessageElement {
  entityUrn?: string;
  body?: { text?: string };
  deliveredAt?: number;
  renderContent?: RenderContentItem[];
  sender?: {
    entityUrn?: string;
    participantType?: {
      member?: {
        firstName?: { text?: string };
        lastName?: { text?: string };
      };
    };
  };
  actor?: {
    entityUrn?: string;
    participantType?: {
      member?: {
        firstName?: { text?: string };
        lastName?: { text?: string };
      };
    };
  };
}

interface MessagesGraphQLResponse {
  data?: {
    messengerMessagesByAnchorTimestamp?: {
      elements?: GraphQLMessageElement[];
    };
  };
}

function extractSenderInfo(
  participant: GraphQLMessageElement['sender'] | undefined,
): { fromName?: string; fromMemberId?: string } {
  if (!participant) return {};
  const member = participant.participantType?.member;
  const fromName = member
    ? [member.firstName?.text, member.lastName?.text].filter(Boolean).join(' ')
    : undefined;
  const fromMemberId = participant.entityUrn?.split(':').pop();
  return { fromName: fromName || undefined, fromMemberId };
}

function extractAttachments(
  renderContent?: RenderContentItem[],
): ViewConversationOutput['messages'][0]['attachments'] {
  if (!renderContent || renderContent.length === 0) return undefined;
  const attachments: NonNullable<
    ViewConversationOutput['messages'][0]['attachments']
  > = [];
  for (const item of renderContent) {
    if (item.file && item.file.url) {
      attachments.push({
        type: 'file',
        name: item.file.name ?? 'unknown',
        mediaType: item.file.mediaType ?? 'application/octet-stream',
        byteSize: item.file.byteSize,
        url: item.file.url,
        assetUrn: item.file.assetUrn,
      });
    } else if (item.vectorImage && item.vectorImage.rootUrl) {
      attachments.push({
        type: 'image',
        name: item.vectorImage.digitalmediaAsset ?? 'image',
        mediaType: 'image/jpeg',
        url: item.vectorImage.rootUrl,
        assetUrn: item.vectorImage.digitalmediaAsset,
      });
    }
  }
  return attachments.length > 0 ? attachments : undefined;
}

export async function viewConversation(opts: {
  csrf: string;
  conversationUrn: string;
}): Promise<ViewConversationOutput> {
  if (
    !opts.conversationUrn ||
    typeof opts.conversationUrn !== 'string' ||
    !opts.conversationUrn.trim()
  ) {
    throw new Validation(
      'viewConversation: conversationUrn is required and must be a non-empty string in the format ' +
        '"urn:li:msg_conversation:(urn:li:fsd_profile:MEMBER_ID,THREAD_ID)". ' +
        'Obtain one from listConversations().conversationUrn or getConversationWithUser().conversationUrn.',
    );
  }
  const queryId = getMessagingQueryId(
    'messengerMessages',
    'get-messages-by-timestamp',
  );
  const conversationUrnEncoded = encodeURIComponent(opts.conversationUrn)
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
  const variables = `(conversationUrn:${conversationUrnEncoded},countBefore:40,countAfter:0,deliveredAt:${Date.now()})`;

  const resp = await linkedinFetch<MessagesGraphQLResponse>(
    opts.csrf,
    `/voyager/api/voyagerMessagingGraphQL/graphql?queryId=${queryId}&variables=${variables}`,
    { headers: { accept: 'application/graphql' } },
  );

  if (!resp.data?.messengerMessagesByAnchorTimestamp) {
    throw new ContractDrift(
      `viewConversation: unexpected response; messengerMessagesByAnchorTimestamp missing. ` +
        `LinkedIn may have changed their GraphQL schema. Response keys: ${resp.data ? Object.keys(resp.data).join(', ') : 'none'}.`,
    );
  }
  const elements = resp.data.messengerMessagesByAnchorTimestamp.elements ?? [];

  const rawMessages: Array<{
    messageUrn?: string;
    text?: string;
    sentAt?: number;
    fromMemberId?: string;
    fromName?: string;
    attachments?: ViewConversationOutput['messages'][0]['attachments'];
  }> = [];
  for (const e of elements) {
    if (!e.entityUrn) continue;
    const sender = extractSenderInfo(e.sender ?? e.actor);
    const attachments = extractAttachments(e.renderContent);
    rawMessages.push({
      messageUrn: e.entityUrn,
      text: e.body?.text,
      sentAt: e.deliveredAt,
      ...sender,
      ...(attachments ? { attachments } : {}),
    });
  }

  // Sort by timestamp ascending
  rawMessages.sort((a, b) => (a.sentAt ?? 0) - (b.sentAt ?? 0));

  return {
    messages: rawMessages.map((m) => ({
      ...m,
      sentAt: epochToIso(m.sentAt),
    })),
  };
}

export async function getConversationWithUser(opts: {
  csrf?: string;
  memberId?: string;
  participantName: string;
  maxConversationsToSearch?: number;
}): Promise<GetConversationWithUserOutput> {
  if (!opts.participantName || typeof opts.participantName !== 'string') {
    return {
      found: false,
      messages: [],
      error: 'Invalid input: participantName is required and must be a string',
    };
  }

  const searchName = opts.participantName.trim();
  if (!searchName) {
    return {
      found: false,
      messages: [],
      error: 'participantName must not be empty',
    };
  }

  // Auto-fetch context if csrf or memberId not provided
  let csrf = opts.csrf;
  let memberId = opts.memberId;
  if (!csrf || !memberId) {
    const ctx = await getContext();
    csrf = csrf || ctx.csrf;
    memberId = memberId || ctx.memberId;
  }

  const maxToSearch = Math.max(opts.maxConversationsToSearch ?? 50, 1);
  const searchNameLower = searchName.toLowerCase();

  // List conversations to find the one with matching participant
  const { conversations } = await listConversations({
    csrf,
    memberId,
    count: maxToSearch,
  });

  // Find all conversations with matching participant name (case-insensitive partial match)
  const matches: Array<{
    conversationUrn: string;
    participantName: string;
    lastMessage?: string;
    lastActivityAt?: string;
  }> = [];
  for (const conv of conversations) {
    const participants = conv.participants ? conv.participants : [];
    for (const participant of participants) {
      if (participant.name?.toLowerCase().includes(searchNameLower)) {
        matches.push({
          conversationUrn: conv.conversationUrn,
          participantName: participant.name,
          lastMessage: conv.lastMessage,
          lastActivityAt: conv.lastActivityAt,
        });
        break;
      }
    }
  }

  if (matches.length > 0) {
    const primary = matches[0];
    const { messages } = await viewConversation({
      csrf,
      conversationUrn: primary.conversationUrn,
    });

    return {
      found: true,
      conversationUrn: primary.conversationUrn,
      participantName: primary.participantName,
      messages,
      ...(matches.length > 1 ? { otherMatches: matches.slice(1) } : {}),
    };
  }

  return {
    found: false,
    messages: [],
    error: `No conversation found with participant matching "${opts.participantName}" in the ${conversations.length} most recent conversations`,
  };
}

/**
 * Upload a single file to LinkedIn messaging infrastructure.
 * Returns the asset URN needed for message sending.
 */
async function uploadFile(
  csrf: string,
  file: { filename: string; mimeType: string; data: string },
): Promise<{
  assetUrn: string;
  byteSize: number;
}> {
  // Decode base64 to binary
  const binaryStr = atob(file.data);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  const byteSize = bytes.length;

  // Step 1: Initialize upload (get pre-signed URL and asset URN)
  const mediaUploadType = file.mimeType.startsWith('image/')
    ? 'MESSAGING_PHOTO_ATTACHMENT'
    : 'MESSAGING_FILE_ATTACHMENT';

  interface UploadMetadataResponse {
    data?: {
      value?: {
        urn?: string;
        singleUploadUrl?: string;
      };
    };
  }

  const initResp = await linkedinFetch<UploadMetadataResponse>(
    csrf,
    '/voyager/api/voyagerVideoDashMediaUploadMetadata?action=upload',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({
        mediaUploadType,
        fileSize: byteSize,
        filename: file.filename,
      }),
    },
  );

  const assetUrn = initResp.data?.value?.urn;
  const uploadUrl = initResp.data?.value?.singleUploadUrl;
  if (!assetUrn || !uploadUrl) {
    throw new ContractDrift(
      `sendMessage upload init failed for ${file.filename}: no assetUrn or uploadUrl in response`,
    );
  }

  // Step 2: PUT binary data to the pre-signed URL
  const putResp = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.mimeType },
    body: bytes,
  });
  if (!putResp.ok && putResp.status !== 201) {
    throwForStatus(putResp.status, `sendMessage file upload failed for ${file.filename}: HTTP ${putResp.status}`);
  }

  return { assetUrn, byteSize };
}

export async function sendMessage(opts: {
  csrf: string;
  myMemberId: string;
  recipient: string;
  text: string;
  files?: Array<{ filename: string; mimeType: string; data: string }>;
  conversationUrn?: string;
}): Promise<SendMessageOutput> {
  // Input validation
  if (!opts.csrf || typeof opts.csrf !== 'string') {
    throw new Validation(
      'sendMessage: csrf is required. Call getContext() first to obtain it.',
    );
  }
  if (!opts.myMemberId || typeof opts.myMemberId !== 'string') {
    throw new Validation(
      'sendMessage: myMemberId is required. Call getContext() to get your member ID.',
    );
  }
  if (!opts.recipient || typeof opts.recipient !== 'string') {
    throw new Validation(
      'sendMessage: recipient is required. Pass a member ID (starts with "ACo"), vanity name (e.g. "john-smith"), or profile URN (urn:li:fsd_profile:ACo...).',
    );
  }
  const hasText =
    opts.text && typeof opts.text === 'string' && opts.text.trim();
  const hasFiles = opts.files && opts.files.length > 0;
  if (!hasText && !hasFiles) {
    throw new Validation('sendMessage: either text or files must be provided.');
  }

  let recipientMemberId = opts.recipient;

  // Resolve recipient if not already a member ID or URN
  if (opts.recipient.startsWith('urn:li:fsd_profile:')) {
    const parts = opts.recipient.split(':');
    recipientMemberId = parts[parts.length - 1];
  } else if (!opts.recipient.startsWith('ACo')) {
    // Try as vanity name using REST API (no queryId needed)
    let resolved: string | null = null;
    try {
      resolved = await resolveVanityNameToMemberId(opts.csrf, opts.recipient);
    } catch {
      // 403/404 from LinkedIn; vanity name doesn't exist or is inaccessible
    }
    if (resolved) {
      recipientMemberId = resolved;
    } else {
      return {
        success: false,
        error: `Could not resolve vanity name "${opts.recipient}". Pass a member ID (starts with "ACo") from searchPeople results instead.`,
      };
    }
  }

  const recipientUrn = `urn:li:fsd_profile:${recipientMemberId}`;
  const mailboxUrn = `urn:li:fsd_profile:${opts.myMemberId}`;

  // Get compose options to find existing conversation
  let conversationUrn = opts.conversationUrn;
  let isNewConversation = !conversationUrn;

  if (!conversationUrn) {
    const composeOpts = await getComposeOptions({
      csrf: opts.csrf,
      recipientMemberId,
    });

    if (composeOpts.existingConversationUrn) {
      // Convert fsd_conversation to msg_conversation format
      const conversationId = composeOpts.existingConversationUrn.replace(
        'urn:li:fsd_conversation:',
        '',
      );
      conversationUrn = `urn:li:msg_conversation:(urn:li:fsd_profile:${opts.myMemberId},${conversationId})`;
      isNewConversation = false;
    }
  }

  // Upload files if provided
  const renderContentUnions: unknown[] = [];
  if (hasFiles) {
    for (const file of opts.files!) {
      const { assetUrn, byteSize } = await uploadFile(opts.csrf, file);
      renderContentUnions.push({
        file: {
          assetUrn,
          byteSize,
          mediaType: file.mimeType,
          name: file.filename,
          url: '',
        },
      });
    }
  }

  interface MessageBody {
    message: {
      body: { text: string; attributes: unknown[] };
      originToken: string;
      renderContentUnions: unknown[];
      conversationUrn?: string;
    };
    mailboxUrn: string;
    trackingId: string;
    hostRecipientUrns?: string[];
    dedupeByClientGeneratedToken: boolean;
  }

  const body: MessageBody = {
    message: {
      body: { text: opts.text || '', attributes: [] },
      originToken: generateUuid(),
      renderContentUnions,
    },
    mailboxUrn,
    trackingId: generateTrackingId(),
    dedupeByClientGeneratedToken: false,
  };

  if (conversationUrn) {
    body.message.conversationUrn = conversationUrn;
  } else {
    body.hostRecipientUrns = [recipientUrn];
  }

  interface SendMessageResponse {
    value?: {
      entityUrn?: string;
      conversationUrn?: string;
      deliveredAt?: number;
    };
  }

  try {
    const resp = await linkedinFetch<SendMessageResponse>(
      opts.csrf,
      '/voyager/api/voyagerMessagingDashMessengerMessages?action=createMessage',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(body),
      },
    );

    return {
      success: true,
      messageUrn: resp.value?.entityUrn,
      conversationUrn: resp.value?.conversationUrn ?? conversationUrn,
      deliveredAt: epochToIso(resp.value?.deliveredAt),
      isNewConversation,
      recipientMemberId,
    };
  } catch (e) {
    const error = e as Error;
    let errorMessage = error.message;

    if (errorMessage.includes('422')) {
      errorMessage =
        'Cannot message this person. They must be a 1st-degree connection.';
    }

    return {
      success: false,
      error: errorMessage,
    };
  }
}

export async function createGroupChat(opts: {
  csrf: string;
  myMemberId: string;
  recipients: string[];
  conversationTitle: string;
  text: string;
}): Promise<CreateGroupChatOutput> {
  if (!opts.csrf || typeof opts.csrf !== 'string') {
    throw new Validation(
      'createGroupChat: csrf is required. Call getContext() first to obtain it.',
    );
  }
  if (!opts.myMemberId || typeof opts.myMemberId !== 'string') {
    throw new Validation(
      'createGroupChat: myMemberId is required. Call getContext() to get your member ID.',
    );
  }
  if (
    !opts.recipients ||
    !Array.isArray(opts.recipients) ||
    opts.recipients.length < 2
  ) {
    throw new Validation(
      'createGroupChat: recipients must be an array of at least 2 member IDs.',
    );
  }
  if (
    !opts.conversationTitle ||
    typeof opts.conversationTitle !== 'string' ||
    !opts.conversationTitle.trim()
  ) {
    throw new Validation(
      'createGroupChat: conversationTitle is required and must not be empty.',
    );
  }
  if (!opts.text || typeof opts.text !== 'string' || !opts.text.trim()) {
    throw new Validation(
      'createGroupChat: text is required; an initial message must be sent when creating a group chat.',
    );
  }

  const mailboxUrn = `urn:li:fsd_profile:${opts.myMemberId}`;
  const hostRecipientUrns = opts.recipients.map(
    (id) => `urn:li:fsd_profile:${id}`,
  );

  interface CreateGroupChatBody {
    message: {
      body: { text: string; attributes: unknown[] };
      originToken: string;
      renderContentUnions: unknown[];
    };
    mailboxUrn: string;
    trackingId: string;
    dedupeByClientGeneratedToken: boolean;
    hostRecipientUrns: string[];
    conversationTitle: string;
  }

  const body: CreateGroupChatBody = {
    message: {
      body: { text: opts.text, attributes: [] },
      originToken: generateUuid(),
      renderContentUnions: [],
    },
    mailboxUrn,
    trackingId: generateTrackingId(),
    dedupeByClientGeneratedToken: false,
    hostRecipientUrns,
    conversationTitle: opts.conversationTitle,
  };

  interface CreateMessageResponse {
    value?: {
      entityUrn?: string;
      conversationUrn?: string;
      deliveredAt?: number;
    };
  }

  try {
    const resp = await linkedinFetch<CreateMessageResponse>(
      opts.csrf,
      '/voyager/api/voyagerMessagingDashMessengerMessages?action=createMessage',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(body),
      },
    );

    return {
      success: true,
      conversationUrn: resp.value?.conversationUrn,
      messageUrn: resp.value?.entityUrn,
      deliveredAt: epochToIso(resp.value?.deliveredAt),
    };
  } catch (e) {
    const error = e as Error;
    let errorMessage = error.message;

    if (errorMessage.includes('422')) {
      errorMessage =
        'Cannot create group chat. All recipients must be 1st-degree connections.';
    }

    return {
      success: false,
      error: errorMessage,
    };
  }
}

export async function renameGroupChat(opts: {
  csrf: string;
  conversationUrn: string;
  title: string;
}): Promise<RenameGroupChatOutput> {
  if (!opts.csrf || typeof opts.csrf !== 'string') {
    throw new Validation(
      'renameGroupChat: csrf is required. Call getContext() first to obtain it.',
    );
  }
  if (
    !opts.conversationUrn ||
    typeof opts.conversationUrn !== 'string' ||
    !opts.conversationUrn.trim()
  ) {
    throw new Validation(
      'renameGroupChat: conversationUrn is required. Obtain from createGroupChat or listConversations.',
    );
  }
  if (!opts.title || typeof opts.title !== 'string' || !opts.title.trim()) {
    throw new Validation(
      'renameGroupChat: title is required and must not be empty.',
    );
  }

  const encodedUrn = encodeUrn(opts.conversationUrn);

  try {
    await linkedinFetch(
      opts.csrf,
      `/voyager/api/voyagerMessagingDashMessengerConversations/${encodedUrn}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=UTF-8',
          'x-restli-protocol-version': '2.0.0',
        },
        body: JSON.stringify({
          patch: {
            $set: {
              title: opts.title,
            },
          },
        }),
      },
    );

    return { success: true };
  } catch (e) {
    const error = e as Error;
    return {
      success: false,
      error: error.message,
    };
  }
}

export async function getComposeOptions(opts: {
  csrf: string;
  recipientMemberId: string;
}): Promise<GetComposeOptionsOutput> {
  if (!opts.csrf || typeof opts.csrf !== 'string') {
    throw new Validation(
      'getComposeOptions: csrf is required. Call getContext() first to obtain it.',
    );
  }
  if (!opts.recipientMemberId || typeof opts.recipientMemberId !== 'string') {
    throw new Validation(
      'getComposeOptions: recipientMemberId is required. Pass a member ID (starts with "ACo") from searchPeople results.',
    );
  }

  const composeOptionUrn = encodeURIComponent(
    `urn:li:fsd_composeOption:(${opts.recipientMemberId},NON_SELF_PROFILE_VIEW,EMPTY_CONTEXT_ENTITY_URN)`,
  );

  interface ComposeResponse {
    data?: {
      composeNavigationContext?: {
        existingConversationUrn?: string;
        paidInMail?: boolean;
      };
      composeOptionType?: string;
    };
  }

  let resp: ComposeResponse;
  try {
    resp = await linkedinFetch<ComposeResponse>(
      opts.csrf,
      `/voyager/api/voyagerMessagingDashComposeOptions/${composeOptionUrn}`,
    );
  } catch (e) {
    const msg = (e as Error).message ?? '';
    if (msg.includes('403')) {
      if (msg.includes('CSRF check failed')) {
        throw new Validation(
          'getComposeOptions: CSRF check failed. The csrf token is invalid or expired; call getContext() to get a fresh token.',
        );
      }
      return { canMessage: false };
    }
    throw e;
  }

  const navCtx = resp.data?.composeNavigationContext;
  return {
    canMessage: resp.data?.composeOptionType !== undefined,
    composeOptionType: resp.data?.composeOptionType,
    paidInMail: navCtx?.paidInMail,
    existingConversationUrn: navCtx?.existingConversationUrn,
  };
}

/**
 * Encode a URN string for LinkedIn API paths.
 */
function encodeUrn(urn: string): string {
  return encodeURIComponent(urn).replace(/\(/g, '%28').replace(/\)/g, '%29');
}

export async function editMessage(opts: {
  csrf: string;
  messageUrn: string;
  newText: string;
}): Promise<EditMessageOutput> {
  if (!opts.csrf || typeof opts.csrf !== 'string') {
    throw new Validation(
      'editMessage: csrf is required. Call getContext() first to obtain it.',
    );
  }
  if (!opts.messageUrn || typeof opts.messageUrn !== 'string') {
    throw new Validation(
      'editMessage: messageUrn is required. Obtain from viewConversation() or sendMessage() results.',
    );
  }
  if (
    !opts.newText ||
    typeof opts.newText !== 'string' ||
    !opts.newText.trim()
  ) {
    throw new Validation('editMessage: newText is required and must not be empty.');
  }

  const encodedUrn = encodeUrn(opts.messageUrn);

  await linkedinFetch(
    opts.csrf,
    `/voyager/api/voyagerMessagingDashMessengerMessages/${encodedUrn}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patch: {
          $set: {
            body: {
              text: opts.newText,
              attributes: [],
            },
          },
        },
      }),
    },
  );

  return { success: true };
}

export async function deleteMessage(opts: {
  csrf: string;
  messageUrn: string;
}): Promise<DeleteMessageOutput> {
  if (!opts.csrf || typeof opts.csrf !== 'string') {
    throw new Validation(
      'deleteMessage: csrf is required. Call getContext() first to obtain it.',
    );
  }
  if (!opts.messageUrn || typeof opts.messageUrn !== 'string') {
    throw new Validation(
      'deleteMessage: messageUrn is required. Obtain from viewConversation() or sendMessage() results.',
    );
  }

  await linkedinFetch(
    opts.csrf,
    '/voyager/api/voyagerMessagingDashMessengerMessages?action=recall',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageUrn: opts.messageUrn }),
    },
  );

  return { success: true };
}

export async function reactToMessage(opts: {
  csrf: string;
  messageUrn: string;
  emoji: string;
}): Promise<ReactToMessageOutput> {
  if (!opts.csrf || typeof opts.csrf !== 'string') {
    throw new Validation(
      'reactToMessage: csrf is required. Call getContext() first to obtain it.',
    );
  }
  if (!opts.messageUrn || typeof opts.messageUrn !== 'string') {
    throw new Validation(
      'reactToMessage: messageUrn is required. Obtain from viewConversation() results.',
    );
  }
  if (!opts.emoji || typeof opts.emoji !== 'string') {
    throw new Validation(
      'reactToMessage: emoji is required (e.g. "👍", "👏", "😊", "❤️", "🔥", "😂").',
    );
  }

  await linkedinFetch(
    opts.csrf,
    '/voyager/api/voyagerMessagingDashMessengerMessages?action=reactWithEmoji',
    {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ messageUrn: opts.messageUrn, emoji: opts.emoji }),
    },
  );

  return { success: true };
}

export async function unreactToMessage(opts: {
  csrf: string;
  messageUrn: string;
  emoji: string;
}): Promise<UnreactToMessageOutput> {
  if (!opts.csrf || typeof opts.csrf !== 'string') {
    throw new Validation(
      'unreactToMessage: csrf is required. Call getContext() first to obtain it.',
    );
  }
  if (!opts.messageUrn || typeof opts.messageUrn !== 'string') {
    throw new Validation(
      'unreactToMessage: messageUrn is required. Obtain from viewConversation() results.',
    );
  }
  if (!opts.emoji || typeof opts.emoji !== 'string') {
    throw new Validation(
      'unreactToMessage: emoji is required. Must match the emoji that was previously reacted with.',
    );
  }

  await linkedinFetch(
    opts.csrf,
    '/voyager/api/voyagerMessagingDashMessengerMessages?action=unreactWithEmoji',
    {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ messageUrn: opts.messageUrn, emoji: opts.emoji }),
    },
  );

  return { success: true };
}

export async function markAllConversationsAsRead(opts: {
  csrf: string;
  until: number;
}): Promise<void> {
  if (!opts.csrf || typeof opts.csrf !== 'string') {
    throw new Validation(
      'markAllConversationsAsRead: csrf is required. Call getContext() first to obtain it.',
    );
  }
  if (
    opts.until === undefined ||
    opts.until === null ||
    typeof opts.until !== 'number'
  ) {
    throw new Validation(
      'markAllConversationsAsRead: until is required. Pass Date.now() to mark all messages up to now as read.',
    );
  }
  if (opts.until <= 0) {
    throw new Validation(
      'markAllConversationsAsRead: until must be a positive epoch timestamp in milliseconds (e.g., Date.now()). Got: ' +
        opts.until,
    );
  }

  await linkedinFetch(
    opts.csrf,
    '/voyager/api/voyagerMessagingDashMessagingBadge?action=markAllMessagesAsSeen',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ until: opts.until }),
    },
  );
}

export async function markConversationAsRead(opts: {
  csrf: string;
  conversationUrn: string;
}): Promise<void> {
  if (!opts.csrf || typeof opts.csrf !== 'string') {
    throw new Validation(
      'markConversationAsRead: csrf is required. Call getContext() first to obtain it.',
    );
  }
  if (
    !opts.conversationUrn ||
    typeof opts.conversationUrn !== 'string' ||
    !opts.conversationUrn.trim()
  ) {
    throw new Validation(
      'markConversationAsRead: conversationUrn is required. Obtain from listConversations() or getConversationWithUser().',
    );
  }

  // Fetch the latest message in the conversation to get its URN
  const { messages } = await viewConversation({
    csrf: opts.csrf,
    conversationUrn: opts.conversationUrn,
  });

  if (messages.length === 0) {
    return; // No messages to acknowledge
  }

  // Get the latest message URN (messages are sorted ascending by sentAt)
  const latestMessage = messages[messages.length - 1];
  if (!latestMessage.messageUrn) {
    return; // No message URN to acknowledge
  }

  await linkedinFetch(
    opts.csrf,
    '/voyager/api/voyagerMessagingDashMessengerMessageDeliveryAcknowledgements?action=sendDeliveryAcknowledgement',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messageUrns: [latestMessage.messageUrn],
        clientId: 'messenger-web',
        deliveryMechanism: 'REALTIME',
        clientConsumedAt: Date.now(),
      }),
    },
  );
}

export async function downloadAttachment(opts: {
  url: string;
}): Promise<DownloadAttachmentOutput> {
  if (!opts.url || typeof opts.url !== 'string') {
    throw new Validation(
      'downloadAttachment: url is required. Pass the attachment URL from viewConversation() message attachments.',
    );
  }

  const resp = await fetch(opts.url);
  if (!resp.ok) {
    throwForStatus(resp.status, `downloadAttachment: failed to download (HTTP ${resp.status}). The URL may have expired; re-fetch the conversation to get a fresh URL.`);
  }

  const contentType =
    resp.headers.get('content-type') ?? 'application/octet-stream';
  const buffer = await resp.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // Convert to base64 in browser
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const data = btoa(binary);

  return {
    data,
    mediaType: contentType,
    byteSize: bytes.length,
  };
}
