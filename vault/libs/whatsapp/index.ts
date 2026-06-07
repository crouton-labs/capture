import type {
  GetContextInput,
  GetContextOutput,
  ListChatsInput,
  ListChatsOutput,
  GetChatInput,
  GetChatOutput,
  GetChatMessagesInput,
  GetChatMessagesOutput,
  GetGroupParticipantsInput,
  GetGroupParticipantsOutput,
  SearchContactsInput,
  SearchContactsOutput,
  CheckNumberExistsInput,
  CheckNumberExistsOutput,
  SendTextMessageInput,
  SendTextMessageOutput,
  CreateGroupChatInput,
  CreateGroupChatOutput,
  DeleteMessageInput,
  DeleteMessageOutput,
} from './schemas';
import { Validation, ContractDrift, NotFound, Unauthenticated } from '@vallum/_runtime';

// ============================================================================
// Internal types for WhatsApp Web page-internal modules
// ============================================================================

interface WAWid {
  server: string;
  user: string;
  _serialized: string;
  toString(): string;
}

interface WAMsgId {
  fromMe: boolean;
  remote: WAWid;
  id: string;
  _serialized: string;
  toString(): string;
}

interface WAModel<TId extends { _serialized: string } = { _serialized: string }> {
  // Common ID shape across WAChatModel (id: WAWid) and WAMsgModel (id: WAMsgId) —
  // the only thing collections operate on is _serialized, so don't over-constrain here.
  id: TId;
  attributes?: Record<string, unknown>;
}

interface WAChatModel extends WAModel {
  id: WAWid;
  name: string;
  msgs: WAMsgCollection;
  unreadCount: number;
  archive: boolean;
  mute?: { isMuted: boolean };
  muteExpiration?: number;
  pin?: number;
  t?: number;
  groupMetadata?: WAGroupMetadata | null;
  contact?: { isBusiness?: boolean };
}

interface WAMsgModel extends WAModel<WAMsgId> {
  id: WAMsgId;
  body: string;
  type: string;
  t: number;
  from?: WAWid;
  to?: WAWid;
  author?: WAWid;
  isForwarded: boolean;
  quotedMsg?: WAMsgModel | null;
  quotedStanzaID?: string | null;
  isMedia: boolean;
  mediaData?: unknown;
  hasMedia?: boolean;
}

interface WAContactModel extends WAModel {
  id: WAWid;
  name?: string;
  pushname?: string;
  formattedName?: string;
  verifiedName?: string;
  isMe: boolean;
  isBusiness?: boolean;
  isMyContact?: boolean;
}

interface WACollection<T extends WAModel<WAWid | WAMsgId>> {
  length: number;
  getModelsArray(): T[];
}

interface WAMsgCollection extends WACollection<WAMsgModel> {
  _models: WAMsgModel[];
}

interface WAParticipantModel {
  id: WAWid;
  isAdmin: boolean;
  isSuperAdmin: boolean;
}

interface WAGroupMetadata {
  id: WAWid;
  subject?: string;
  desc?: string | null;
  owner?: WAWid;
  creation?: number;
  announce?: boolean;
  size?: number;
  participants: WACollection<WAParticipantModel>;
  attributes?: {
    subject?: string;
    desc?: string | null;
    owner?: WAWid;
    creation?: number;
    announce?: boolean;
  };
}

interface WAWidFactoryMod {
  createWid(idLike: string): WAWid;
  createUserWidOrThrow(idLike: string): WAWid;
  asChatWid(wid: WAWid): WAWid;
}

interface WAQueryExistsJob {
  queryPhoneExists(
    phone: string,
    extra?: unknown,
  ): Promise<{ wid?: WAWid; biz?: boolean } | null>;
  queryWidExists(wid: WAWid): Promise<{ wid?: WAWid } | null>;
}

interface WACollections {
  Chat: WACollection<WAChatModel>;
  Contact: WACollection<WAContactModel>;
  Msg: WACollection<WAMsgModel>;
}

interface WAMeUser {
  getMaybeMePnUser(): WAWid | null;
  getMaybeMeLidUser(): WAWid | null;
  getMeDisplayNameOrThrow(): string;
}

interface WASendTextAction {
  sendTextMsgToChat(
    chat: WAChatModel,
    text: string,
    extras?: unknown,
  ): Promise<WAMsgModel>;
  addAndSendTextMsg(
    chat: WAChatModel,
    text: string,
    extras?: unknown,
  ): Promise<WAMsgModel>;
}

interface WACmdModule {
  Cmd: {
    openChatAt(opts: { chat: WAChatModel; msgKey?: unknown }): Promise<void>;
    sendRevokeMsgs(
      chat: WAChatModel,
      msgs: WAMsgModel[],
      opts: { clearMedia: boolean; type: string },
    ): Promise<void>;
    sendDeleteMsgs(
      chat: WAChatModel,
      msgs: WAMsgModel[],
      clearMedia: boolean,
      isInternal: boolean,
      isInline: boolean,
      isOffline: boolean,
    ): Promise<void>;
  };
}

interface WALoadMessages {
  loadRecentMsgs(chat: WAChatModel): Promise<unknown>;
  loadEarlierMsgs(chat: WAChatModel): Promise<unknown>;
}

interface WARevokeMsgAction {
  sendRevoke(
    msg: WAMsgModel,
    isAdmin: boolean,
    extra?: unknown,
  ): Promise<unknown>;
}

// ============================================================================
// Module accessors (lazy require)
// ============================================================================

function waRequire<T>(name: string): T {
  const req = (window as unknown as { require?: (n: string) => unknown })
    .require;
  if (typeof req !== 'function') {
    throw new ContractDrift(
      'WhatsApp Web module loader not found. Make sure you are on https://web.whatsapp.com and the QR code has been scanned.',
    );
  }
  try {
    return req(name) as T;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new ContractDrift(`Failed to load WhatsApp module "${name}": ${msg}`);
  }
}

function getCollections(): WACollections {
  return waRequire<WACollections>('WAWebCollections');
}

function getMeUserMod(): WAMeUser {
  return waRequire<WAMeUser>('WAWebUserPrefsMeUser');
}

function getWidFactory(): WAWidFactoryMod {
  return waRequire<WAWidFactoryMod>('WAWebWidFactory');
}

function getCmd(): WACmdModule {
  return waRequire<WACmdModule>('WAWebCmd');
}

function getLoadMessages(): WALoadMessages {
  return waRequire<WALoadMessages>('WAWebChatLoadMessages');
}

function getSendTextAction(): WASendTextAction {
  return waRequire<WASendTextAction>('WAWebSendTextMsgChatAction');
}

function getQueryExistsJob(): WAQueryExistsJob {
  return waRequire<WAQueryExistsJob>('WAWebQueryExistsJob');
}

function _getRevokeAction(): WARevokeMsgAction {
  return waRequire<WARevokeMsgAction>('WAWebRevokeMsgAction');
}

// ============================================================================
// Internal helpers
// ============================================================================

function widString(wid: WAWid | undefined | null): string | null {
  if (!wid) return null;
  if (typeof wid === 'string') return wid;
  return wid._serialized ?? String(wid);
}

function chatIsGroup(chat: WAChatModel): boolean {
  return (chat.id?._serialized ?? '').endsWith('@g.us');
}

interface WAFindChatAction {
  findOrCreateLatestChat(
    wid: WAWid,
    extra1?: unknown,
    extra2?: unknown,
  ): Promise<{ chat: WAChatModel; created: boolean }>;
}

function findChatByIdSync(chatId: string): WAChatModel | null {
  const chats = getCollections().Chat.getModelsArray();
  return chats.find((c) => c.id?._serialized === chatId) ?? null;
}

/**
 * Resolve a chatId to a chat model. If the chat isn't in the local collection
 * (e.g. the user hasn't messaged this contact before, or the chat is stored
 * under a @lid rather than @c.us), uses findOrCreateLatestChat to locate or
 * create it.
 */
async function findChatById(chatId: string): Promise<WAChatModel> {
  // Fast path: direct id match
  const direct = findChatByIdSync(chatId);
  if (direct) return direct;

  // Slow path: WhatsApp internally may key the chat under a @lid.
  // findOrCreateLatestChat resolves the WID to the correct internal chat.
  const WidFactory = getWidFactory();
  const wid = WidFactory.createWid(chatId);
  const FindChat = waRequire<WAFindChatAction>('WAWebFindChatAction');
  const result = await FindChat.findOrCreateLatestChat(wid);
  const chat = result.chat;
  if (!chat || !chat.id) {
    throw new NotFound(
      `Chat not found: ${chatId}. Ensure the contact exists on WhatsApp. Use searchContacts or checkNumberExists first.`,
    );
  }
  return chat;
}

function contactDisplayName(contact: WAContactModel): string {
  return (
    contact.name ||
    contact.pushname ||
    contact.formattedName ||
    contact.verifiedName ||
    contact.id?.user ||
    ''
  );
}

function chatLastMessageTimestamp(chat: WAChatModel): number | null {
  const t = chat.t ?? (chat.attributes as { t?: number } | undefined)?.t;
  return typeof t === 'number' && t > 0 ? t : null;
}

function summarizeChat(chat: WAChatModel): {
  chatId: string;
  name: string;
  isGroup: boolean;
  unreadCount: number;
  lastMessageTimestamp: number | null;
  isArchived: boolean;
  isMuted: boolean;
  pinned: boolean;
} {
  const isGroup = chatIsGroup(chat);
  const muteExp = chat.muteExpiration ?? 0;
  return {
    chatId: chat.id._serialized,
    name: chat.name || (isGroup ? 'Unnamed group' : chat.id.user),
    isGroup,
    unreadCount: chat.unreadCount ?? 0,
    lastMessageTimestamp: chatLastMessageTimestamp(chat),
    isArchived: Boolean(chat.archive),
    isMuted: muteExp > Math.floor(Date.now() / 1000),
    pinned: Boolean(chat.pin && chat.pin > 0),
  };
}

function normalizeMessage(m: WAMsgModel, chatId: string) {
  const id = m.id;
  const fullId = typeof id === 'string' ? id : (id?._serialized ?? String(id));
  const fromMe = Boolean(id?.fromMe);
  const quotedStanza = m.quotedStanzaID ?? m.quotedMsg?.id?._serialized ?? null;
  return {
    messageId: fullId,
    chatId,
    body: m.body ?? '',
    type: m.type ?? 'unknown',
    fromMe,
    author: widString(m.author),
    timestamp: m.t ?? 0,
    hasMedia: Boolean(m.hasMedia || m.isMedia),
    isForwarded: Boolean(m.isForwarded),
    quotedMessageId: quotedStanza,
  };
}

async function openChat(chat: WAChatModel): Promise<void> {
  const { Cmd } = getCmd();
  await Cmd.openChatAt({ chat });
  // Small settle for the React render + initial msg load
  await new Promise((resolve) => setTimeout(resolve, 500));
}

async function ensureMessagesLoaded(
  chat: WAChatModel,
  desired: number,
): Promise<WAMsgModel[]> {
  await openChat(chat);
  let msgs = chat.msgs.getModelsArray();
  const LoadMsgs = getLoadMessages();

  // Paginate earlier until we have enough or pagination stops growing.
  // loadEarlierMsgs rejects when there is no more history — treat that as
  // "we have everything" rather than an error.
  let attempts = 0;
  while (msgs.length < desired && attempts < 10) {
    const before = msgs.length;
    await LoadMsgs.loadEarlierMsgs(chat).catch((): undefined => {
      // See note above: no-more-history rejection is expected and absorbed here.
      return undefined;
    });
    msgs = chat.msgs.getModelsArray();
    if (msgs.length === before) break;
    attempts += 1;
  }
  return msgs;
}

// ============================================================================
// Exported functions
// ============================================================================

export async function getContext(
  _args: GetContextInput = {},
): Promise<GetContextOutput> {
  if (!window.location.href.startsWith('https://web.whatsapp.com')) {
    throw new Validation(
      `getContext must be called from https://web.whatsapp.com, current URL: ${window.location.href}`,
    );
  }

  const MeMod = getMeUserMod();
  const mePn = MeMod.getMaybeMePnUser();
  if (!mePn || !mePn._serialized) {
    throw new Unauthenticated(
      'WhatsApp Web session not ready. Scan the QR code in the browser first.',
    );
  }
  const meLid = MeMod.getMaybeMeLidUser();

  // getMeDisplayNameOrThrow() is unreliable in recent builds and Contact.isMe
  // is not populated — look up the own contact record by id match instead.
  const Col = getCollections();
  const meIdStr = mePn._serialized;
  const meContact = Col.Contact.getModelsArray().find(
    (c) => c.id && c.id._serialized === meIdStr,
  );
  const displayName = meContact ? contactDisplayName(meContact) : '';

  return {
    meId: mePn._serialized,
    mePhone: mePn.user,
    meLid: meLid ? meLid._serialized : '',
    displayName,
    chatCount: Col.Chat.length,
    contactCount: Col.Contact.length,
  };
}

export async function listChats(
  args: ListChatsInput,
): Promise<ListChatsOutput> {
  const limit = args.limit ?? 50;
  const includeGroups = args.includeGroups ?? true;
  const includeIndividuals = args.includeIndividuals ?? true;
  const onlyUnread = args.onlyUnread ?? false;

  const all = getCollections().Chat.getModelsArray();
  const summaries = all
    .map(summarizeChat)
    .filter((s) => {
      if (!includeGroups && s.isGroup) return false;
      if (!includeIndividuals && !s.isGroup) return false;
      if (onlyUnread && s.unreadCount <= 0) return false;
      return true;
    })
    .sort(
      (a, b) => (b.lastMessageTimestamp ?? 0) - (a.lastMessageTimestamp ?? 0),
    )
    .slice(0, limit);

  return { chats: summaries };
}

export async function getChat(args: GetChatInput): Promise<GetChatOutput> {
  const chat = await findChatById(args.chatId);
  const summary = summarizeChat(chat);
  const isGroup = summary.isGroup;

  let groupInfo: GetChatOutput['groupInfo'] = null;
  if (isGroup) {
    const gm = chat.groupMetadata;
    if (gm) {
      const attrs = gm.attributes ?? {};
      groupInfo = {
        subject: (attrs.subject ?? gm.subject ?? summary.name) || summary.name,
        description: attrs.desc ?? gm.desc ?? null,
        createdAt: attrs.creation ?? gm.creation ?? null,
        ownerId: widString(attrs.owner ?? gm.owner),
        participantCount: gm.participants?.length ?? 0,
        isAnnouncementOnly: Boolean(attrs.announce ?? gm.announce),
      };
    } else {
      groupInfo = {
        subject: summary.name,
        description: null,
        createdAt: null,
        ownerId: null,
        participantCount: 0,
        isAnnouncementOnly: false,
      };
    }
  }

  return {
    chatId: summary.chatId,
    name: summary.name,
    isGroup,
    unreadCount: summary.unreadCount,
    isArchived: summary.isArchived,
    isMuted: summary.isMuted,
    pinned: summary.pinned,
    groupInfo,
  };
}

export async function getChatMessages(
  args: GetChatMessagesInput,
): Promise<GetChatMessagesOutput> {
  const limit = args.limit ?? 30;
  const chat = await findChatById(args.chatId);
  const all = await ensureMessagesLoaded(chat, limit);
  const sorted = all.slice().sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  const truncated = sorted.slice(Math.max(0, sorted.length - limit));
  return {
    chatId: chat.id._serialized,
    chatName: chat.name || chat.id.user,
    isGroup: chatIsGroup(chat),
    messages: truncated.map((m) => normalizeMessage(m, chat.id._serialized)),
  };
}

export async function getGroupParticipants(
  args: GetGroupParticipantsInput,
): Promise<GetGroupParticipantsOutput> {
  const chat = await findChatById(args.chatId);
  if (!chatIsGroup(chat)) {
    throw new Validation(
      `getGroupParticipants requires a group chatId (@g.us), got: ${args.chatId}`,
    );
  }
  const gm = chat.groupMetadata;
  if (!gm) {
    throw new ContractDrift(
      `Group metadata not loaded for ${args.chatId}. Open the chat in the UI first with getChatMessages.`,
    );
  }
  const list = gm.participants.getModelsArray();
  const attrs = gm.attributes ?? {};

  // Resolve each participant's LID → phone number + name via the Contact collection
  const allContacts = getCollections().Contact.getModelsArray();
  const resolvedParticipants = list.map((p) => {
    const lid = widString(p.id) ?? '';
    // Find the @lid contact record
    const lidContact = allContacts.find(
      (c) => c.id && c.id._serialized === lid,
    );
    const name = lidContact ? contactDisplayName(lidContact) : '';
    // Find the matching @c.us record by name
    let phone = '';
    let chatId: string | null = null;
    if (name) {
      const cusContact = allContacts.find(
        (c) =>
          c.id &&
          c.id._serialized.endsWith('@c.us') &&
          ((c.name && c.name === lidContact!.name) ||
            (c.pushname && c.pushname === lidContact!.pushname)),
      );
      if (cusContact) {
        phone = cusContact.id.user;
        chatId = cusContact.id._serialized;
      }
    }
    return {
      participantId: lid,
      chatId,
      phone,
      name,
      isAdmin: Boolean(p.isAdmin),
      isSuperAdmin: Boolean(p.isSuperAdmin),
    };
  });

  return {
    chatId: chat.id._serialized,
    groupName: (attrs.subject ?? gm.subject ?? chat.name) || chat.name,
    ownerId: widString(attrs.owner ?? gm.owner),
    participantCount: list.length,
    participants: resolvedParticipants,
  };
}

export async function searchContacts(
  args: SearchContactsInput,
): Promise<SearchContactsOutput> {
  const limit = args.limit ?? 10;
  const q = args.query.toLowerCase();
  const all = getCollections().Contact.getModelsArray();
  const matches: Array<{
    contact: WAContactModel;
    score: number;
  }> = [];

  for (const c of all) {
    const id = c.id?._serialized ?? '';
    // Only consider user contacts (@c.us), skip @lid duplicates
    if (!id.endsWith('@c.us')) continue;
    const display = contactDisplayName(c).toLowerCase();
    const phone = c.id?.user ?? '';
    if (display.includes(q) || phone.includes(q)) {
      // Rank: exact name-start > display contains > phone contains
      let score = 0;
      if (display.startsWith(q)) score += 100;
      else if (display.includes(q)) score += 50;
      if (phone.startsWith(q)) score += 40;
      else if (phone.includes(q)) score += 10;
      if (c.isMyContact) score += 5;
      matches.push({ contact: c, score });
    }
  }

  matches.sort((a, b) => b.score - a.score);

  return {
    query: args.query,
    contacts: matches.slice(0, limit).map(({ contact }) => ({
      contactId: contact.id._serialized,
      phone: contact.id.user,
      name: contactDisplayName(contact),
      pushName: contact.pushname ?? '',
      isMe: Boolean(contact.isMe),
      isBusiness: Boolean(contact.isBusiness),
      isContact: Boolean(contact.isMyContact),
    })),
  };
}

export async function checkNumberExists(
  args: CheckNumberExistsInput,
): Promise<CheckNumberExistsOutput> {
  const phone = args.phone.replace(/[^0-9]/g, '');
  if (!phone) {
    throw new Validation(`Invalid phone: "${args.phone}"`);
  }
  const query = getQueryExistsJob();
  const result = await query.queryPhoneExists(phone);
  if (result && result.wid) {
    // queryPhoneExists may return a @lid WID; convert to @c.us for chatId
    const wid = result.wid;
    const chatId = wid.server === 'c.us' ? wid._serialized : `${phone}@c.us`;
    return { phone, exists: true, chatId };
  }
  return { phone, exists: false, chatId: null };
}

export async function sendTextMessage(
  args: SendTextMessageInput,
): Promise<SendTextMessageOutput> {
  if (args.text.length === 0) {
    throw new Validation('sendTextMessage: text is required');
  }
  const chat = await findChatById(args.chatId);
  // Make sure the chat is "opened" at least once so WA's send pipeline has state
  await openChat(chat);

  const { sendTextMsgToChat } = getSendTextAction();
  await sendTextMsgToChat(chat, args.text, undefined);

  // sendTextMsgToChat's return value is inconsistent across WA builds, so
  // locate the newly-sent message by scanning chat.msgs for the newest
  // fromMe message with matching body.
  const msgs = chat.msgs.getModelsArray();
  let foundMsg: WAMsgModel | null = null;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.id && m.id.fromMe && m.body === args.text) {
      foundMsg = m;
      break;
    }
  }

  if (!foundMsg) {
    throw new ContractDrift(
      `sendTextMessage: could not locate sent message in chat ${args.chatId} after send`,
    );
  }

  return {
    chatId: chat.id._serialized,
    messageId: foundMsg.id._serialized,
    timestamp: foundMsg.t,
  };
}

export async function createGroupChat(
  args: CreateGroupChatInput,
): Promise<CreateGroupChatOutput> {
  const name = args.name.trim();
  if (!name) throw new Validation('createGroupChat: name is required');
  if (
    !Array.isArray(args.participantChatIds) ||
    args.participantChatIds.length === 0
  ) {
    throw new Validation(
      'createGroupChat: participantChatIds must be a non-empty array',
    );
  }

  for (const pid of args.participantChatIds) {
    if (!pid.endsWith('@c.us')) {
      throw new Validation(
        `Participant chatId must end in @c.us, got: ${pid}. Use searchContacts or checkNumberExists first.`,
      );
    }
  }

  // WAWebGroupCreateJob.createGroup expects participants as
  // {phoneNumber: WAWid, lid?: WAWid} objects.
  const WidFactory = getWidFactory();
  const ContactCol = getCollections().Contact;
  const allContacts = ContactCol.getModelsArray();

  const participantArgs = args.participantChatIds.map((pid) => {
    const pnWid = WidFactory.createWid(pid);
    // Resolve matching LID contact (needed for the XMPP stanza)
    const pnContact = allContacts.find((c) => c.id && c.id._serialized === pid);
    const lidContact = pnContact
      ? allContacts.find(
          (c) =>
            c.id &&
            c.id._serialized.endsWith('@lid') &&
            c.name &&
            pnContact.name &&
            c.name === pnContact.name,
        )
      : null;
    return {
      phoneNumber: pnWid,
      lid: lidContact ? lidContact.id : undefined,
    };
  });

  const Job = waRequire<{
    createGroup(
      opts: { title: string },
      participants: Array<{ phoneNumber: WAWid; lid?: WAWid }>,
    ): Promise<{ wid?: WAWid; subject?: string; participants?: unknown[] }>;
  }>('WAWebGroupCreateJob');

  const result = await Job.createGroup({ title: name }, participantArgs);
  if (!result || !result.wid) {
    throw new ContractDrift('createGroupChat: server did not return a group WID');
  }

  // Give the ChatCollection a moment to receive the new group
  await new Promise((r) => setTimeout(r, 1500));

  const groupId = result.wid._serialized;
  const participantCount = Array.isArray(result.participants)
    ? result.participants.length
    : args.participantChatIds.length + 1;

  return { chatId: groupId, name, participantCount };
}

export async function deleteMessage(
  args: DeleteMessageInput,
): Promise<DeleteMessageOutput> {
  const forEveryone = args.forEveryone ?? true;

  if (forEveryone && !args.messageId.startsWith('true_')) {
    throw new Validation(
      `deleteMessage with forEveryone=true only works on messages the current user sent — messageId must start with "true_", got: ${args.messageId}`,
    );
  }

  const chat = await findChatById(args.chatId);
  await ensureMessagesLoaded(chat, 200);

  const msgs = chat.msgs.getModelsArray();
  const msg = msgs.find((m) => m.id && m.id._serialized === args.messageId);
  if (!msg) {
    throw new NotFound(
      `deleteMessage: message ${args.messageId} not found in chat ${args.chatId}. The message may be older than the loaded history — call getChatMessages with a larger limit first.`,
    );
  }

  const { Cmd } = getCmd();
  if (forEveryone) {
    await Cmd.sendRevokeMsgs(chat, [msg], {
      clearMedia: true,
      type: 'Sender',
    });
  } else {
    await Cmd.sendDeleteMsgs(chat, [msg], false, false, false, false);
  }

  return {
    chatId: chat.id._serialized,
    messageId: args.messageId,
    revoked: forEveryone,
  };
}
