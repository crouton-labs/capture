import { apiUrl, apiFetch, getDsc } from '../helpers';
import { Validation, PermissionDenied, throwForStatus } from '@vallum/_runtime';
import type {
  SearchInput,
  SearchOutput,
  ListBoardActivityInput,
  ListBoardActivityOutput,
  ListCardActivityInput,
  ListCardActivityOutput,
  ListMemberActivityInput,
  ListMemberActivityOutput,
  ListNotificationsInput,
  ListNotificationsOutput,
  GetNotificationsCountInput,
  GetNotificationsCountOutput,
  MarkNotificationsReadInput,
  MarkNotificationsReadOutput,
  ListAttachmentsInput,
  ListAttachmentsOutput,
  CreateAttachmentInput,
  CreateAttachmentOutput,
  DeleteAttachmentInput,
  DeleteAttachmentOutput,
  ListCustomFieldsInput,
  ListCustomFieldsOutput,
  SetCustomFieldValueInput,
  SetCustomFieldValueOutput,
  BulkMoveCardsInput,
  BulkMoveCardsOutput,
  BulkArchiveCardsInput,
  BulkArchiveCardsOutput,
  BulkAddLabelToCardsInput,
  BulkAddLabelToCardsOutput,
} from './schemas';

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ============================================================================
// Search
// ============================================================================

export async function search(params: SearchInput): Promise<SearchOutput> {
  const {
    query,
    modelTypes = 'cards,boards,members',
    cardsLimit = 10,
    boardsLimit = 10,
    membersLimit = 10,
    partial,
    cardsPage,
    cardBoard,
    cardList,
    boardOrganization,
    boardOrganizationFields,
    memberFields,
    organizationFields,
  } = params;

  if (!query) {
    throw new Validation('search: query is required');
  }

  const qs = new URLSearchParams({
    query,
    modelTypes,
    card_fields: 'all',
    cards_limit: String(cardsLimit),
    board_fields: 'name,url',
    boards_limit: String(boardsLimit),
    members_limit: String(membersLimit),
  });

  if (partial !== undefined) qs.set('partial', String(partial));
  if (cardsPage !== undefined) qs.set('cards_page', String(cardsPage));
  if (cardBoard !== undefined) qs.set('card_board', String(cardBoard));
  if (cardList !== undefined) qs.set('card_list', String(cardList));
  if (boardOrganization !== undefined)
    qs.set('board_organization', String(boardOrganization));
  if (boardOrganizationFields !== undefined)
    qs.set('board_organization_fields', boardOrganizationFields);
  if (memberFields !== undefined) qs.set('member_fields', memberFields);
  if (organizationFields !== undefined)
    qs.set('organization_fields', organizationFields);

  const res = await apiFetch(`${window.location.origin}/1/search?${qs}`);
  const data = await res.json();

  type RawCard = {
    id: string;
    name: string;
    idBoard: string;
    idList: string;
    shortLink: string;
    url: string;
    desc: string;
    due: string | null;
    closed: boolean;
    board?: { id: string; name: string; url: string };
    list?: {
      id: string;
      name: string;
      closed: boolean;
      color: string | null;
      idBoard: string;
      pos: number;
      subscribed: boolean;
      softLimit: number | null;
      type: string | null;
    };
  };

  type RawBoard = {
    id: string;
    name: string;
    url?: string;
    organization?: { id: string; name: string; displayName: string };
  };

  type RawMember = {
    id: string;
    username: string;
    fullName: string;
    avatarUrl: string | null;
  };

  type RawOrganization = {
    id: string;
    name: string;
    displayName: string;
    desc?: string;
    url?: string;
    logoHash?: string | null;
    logoUrl?: string | null;
    website?: string | null;
  };

  const cards = ((data.cards ?? []) as RawCard[]).map((c) => {
    const card: {
      id: string;
      name: string;
      idBoard: string;
      idList: string;
      shortLink: string;
      url: string;
      desc: string;
      due: string | null;
      closed: boolean;
      board?: { id: string; name: string; url: string };
      list?: {
        id: string;
        name: string;
        closed: boolean;
        color: string | null;
        idBoard: string;
        pos: number;
        subscribed: boolean;
        softLimit: number | null;
        type: string | null;
      };
    } = {
      id: c.id,
      name: c.name,
      idBoard: c.idBoard,
      idList: c.idList,
      shortLink: c.shortLink,
      url: c.url,
      desc: c.desc,
      due: c.due,
      closed: c.closed,
    };
    if (c.board !== undefined)
      card.board = { id: c.board.id, name: c.board.name, url: c.board.url };
    if (c.list !== undefined)
      card.list = {
        id: c.list.id,
        name: c.list.name,
        closed: c.list.closed,
        color: c.list.color,
        idBoard: c.list.idBoard,
        pos: c.list.pos,
        subscribed: c.list.subscribed,
        softLimit: c.list.softLimit,
        type: c.list.type,
      };
    return card;
  });

  const boards = ((data.boards ?? []) as RawBoard[]).map((b) => {
    const board: {
      id: string;
      name: string;
      url?: string;
      organization?: { id: string; name: string; displayName: string };
    } = {
      id: b.id,
      name: b.name,
      url: b.url,
    };
    if (b.organization !== undefined) {
      board.organization = {
        id: b.organization.id,
        name: b.organization.name,
        displayName: b.organization.displayName,
      };
    }
    return board;
  });

  const members = ((data.members ?? []) as RawMember[]).map((m) => ({
    id: m.id,
    username: m.username,
    fullName: m.fullName,
    avatarUrl: m.avatarUrl,
  }));

  const organizations = ((data.organizations ?? []) as RawOrganization[]).map(
    (o) => {
      const org: {
        id: string;
        name: string;
        displayName: string;
        desc?: string;
        url?: string;
        logoHash?: string | null;
        logoUrl?: string | null;
        website?: string | null;
      } = { id: o.id, name: o.name, displayName: o.displayName };
      if (o.desc !== undefined) org.desc = o.desc;
      if (o.url !== undefined) org.url = o.url;
      if (o.logoHash !== undefined) org.logoHash = o.logoHash;
      if (o.logoUrl !== undefined) org.logoUrl = o.logoUrl;
      if (o.website !== undefined) org.website = o.website;
      return org;
    },
  );

  const actions = ((data.actions ?? []) as RawAction[]).map((a) => {
    const action: {
      id: string;
      type: string;
      date: string;
      data?: { [key: string]: unknown };
      memberCreator?: {
        id: string;
        username: string;
        fullName: string;
        initials: string;
        avatarUrl: string | null;
      };
      entities?: { [key: string]: unknown }[];
      reactions?: { [key: string]: unknown }[];
      display?: {
        translationKey: string;
        entities: { [key: string]: unknown };
      };
    } = { id: a.id, type: a.type, date: a.date };
    if (a.data !== undefined) action.data = a.data;
    if (a.memberCreator !== undefined) {
      action.memberCreator = {
        id: a.memberCreator.id,
        username: a.memberCreator.username,
        fullName: a.memberCreator.fullName,
        initials: a.memberCreator.initials,
        avatarUrl: a.memberCreator.avatarUrl,
      };
    }
    if (a.entities !== undefined) action.entities = a.entities;
    if (a.reactions !== undefined) action.reactions = a.reactions;
    if (a.display !== undefined) action.display = a.display;
    return action;
  });

  return { cards, boards, members, organizations, actions };
}

// ============================================================================
// Activity
// ============================================================================

type RawAction = {
  id: string;
  type: string;
  date: string;
  data?: { [key: string]: unknown };
  memberCreator?: {
    id: string;
    username: string;
    fullName: string;
    initials: string;
    avatarUrl: string | null;
  };
  entities?: { [key: string]: unknown }[];
  reactions?: { [key: string]: unknown }[];
  display?: {
    translationKey: string;
    entities: { [key: string]: unknown };
  };
};

function mapActions(raw: RawAction[]) {
  return raw.map((a) => {
    const action: {
      id: string;
      type: string;
      date: string;
      data?: { [key: string]: unknown };
      memberCreator?: {
        id: string;
        username: string;
        fullName: string;
        initials: string;
        avatarUrl: string | null;
      };
      entities?: { [key: string]: unknown }[];
      reactions?: { [key: string]: unknown }[];
      display?: {
        translationKey: string;
        entities: { [key: string]: unknown };
      };
    } = {
      id: a.id,
      type: a.type,
      date: a.date,
    };
    if (a.data !== undefined) action.data = a.data;
    if (a.memberCreator !== undefined) {
      action.memberCreator = {
        id: a.memberCreator.id,
        username: a.memberCreator.username,
        fullName: a.memberCreator.fullName,
        initials: a.memberCreator.initials,
        avatarUrl: a.memberCreator.avatarUrl,
      };
    }
    if (a.entities !== undefined) action.entities = a.entities;
    if (a.reactions !== undefined) action.reactions = a.reactions;
    if (a.display !== undefined) action.display = a.display;
    return action;
  });
}

export async function listBoardActivity(
  params: ListBoardActivityInput,
): Promise<ListBoardActivityOutput> {
  const {
    boardId,
    limit = 50,
    before,
    since,
    filter,
    fields,
    memberCreator,
    memberCreator_fields,
    member,
    member_fields,
    entities,
    reactions,
    page,
    display,
  } = params;

  const qs = new URLSearchParams({ limit: String(limit) });
  if (before) qs.set('before', before);
  if (since) qs.set('since', since);
  if (filter) qs.set('filter', filter);
  if (fields) qs.set('fields', fields);
  if (memberCreator !== undefined)
    qs.set('memberCreator', String(memberCreator));
  if (memberCreator_fields)
    qs.set('memberCreator_fields', memberCreator_fields);
  if (member !== undefined) qs.set('member', String(member));
  if (member_fields) qs.set('member_fields', member_fields);
  if (entities !== undefined) qs.set('entities', String(entities));
  if (reactions !== undefined) qs.set('reactions', String(reactions));
  if (page !== undefined) qs.set('page', String(page));
  if (display !== undefined) qs.set('display', String(display));

  const res = await apiFetch(apiUrl(`boards/${boardId}/actions?${qs}`));
  const data: RawAction[] = await res.json();
  const actions = mapActions(data);
  const lastAction = actions[actions.length - 1];
  const nextCursor =
    actions.length > 0 && actions.length === limit ? lastAction.id : null;

  return { actions, nextCursor };
}

export async function listCardActivity(
  params: ListCardActivityInput,
): Promise<ListCardActivityOutput> {
  const {
    cardId,
    limit = 50,
    before,
    since,
    filter,
    fields,
    memberCreator,
    memberCreator_fields,
    member,
    member_fields,
    entities,
    reactions,
    page,
    display,
  } = params;

  const qs = new URLSearchParams({
    filter: filter ?? 'all',
    limit: String(limit),
  });
  if (before) qs.set('before', before);
  if (since) qs.set('since', since);
  if (fields) qs.set('fields', fields);
  if (memberCreator !== undefined)
    qs.set('memberCreator', String(memberCreator));
  if (memberCreator_fields)
    qs.set('memberCreator_fields', memberCreator_fields);
  if (member !== undefined) qs.set('member', String(member));
  if (member_fields) qs.set('member_fields', member_fields);
  if (entities !== undefined) qs.set('entities', String(entities));
  if (reactions !== undefined) qs.set('reactions', String(reactions));
  if (page !== undefined) qs.set('page', String(page));
  if (display !== undefined) qs.set('display', String(display));

  const res = await apiFetch(apiUrl(`cards/${cardId}/actions?${qs}`));
  const data: RawAction[] = await res.json();
  const actions = mapActions(data);
  const nextCursor = actions.length > 0 ? actions[actions.length - 1].id : null;

  return { actions, nextCursor };
}

export async function listMemberActivity(
  params: ListMemberActivityInput,
): Promise<ListMemberActivityOutput> {
  const {
    memberId = 'me',
    limit = 50,
    before,
    since,
    filter,
    fields,
    memberCreator,
    memberCreator_fields,
    member,
    member_fields,
    entities,
    reactions,
    page,
    display,
  } = params;

  const qs = new URLSearchParams({ limit: String(limit) });
  if (before) qs.set('before', before);
  if (since) qs.set('since', since);
  if (filter) qs.set('filter', filter);
  if (fields) qs.set('fields', fields);
  if (memberCreator !== undefined)
    qs.set('memberCreator', String(memberCreator));
  if (memberCreator_fields)
    qs.set('memberCreator_fields', memberCreator_fields);
  if (member !== undefined) qs.set('member', String(member));
  if (member_fields) qs.set('member_fields', member_fields);
  if (entities !== undefined) qs.set('entities', String(entities));
  if (reactions !== undefined) qs.set('reactions', String(reactions));
  if (page !== undefined) qs.set('page', String(page));
  if (display !== undefined) qs.set('display', String(display));

  const res = await apiFetch(apiUrl(`members/${memberId}/actions?${qs}`));
  const data: RawAction[] = await res.json();
  const actions = mapActions(data);
  const lastAction = actions[actions.length - 1];
  const nextCursor =
    actions.length > 0 && actions.length === limit ? lastAction.id : null;

  return { actions, nextCursor };
}

// ============================================================================
// Notifications
// ============================================================================

export async function listNotifications(
  params: ListNotificationsInput,
): Promise<ListNotificationsOutput> {
  const {
    limit = 10,
    skip = 0,
    readFilter = 'unread',
    filter,
    before,
    since,
    memberCreator,
    memberCreator_fields,
    board,
    board_fields,
    card,
    card_fields,
    list,
    list_fields,
    member,
    member_fields,
    display,
    entities,
    reactions,
    page,
    fields,
  } = params;

  const qs = new URLSearchParams({
    limit: String(limit),
    skip: String(skip),
    read_filter: readFilter,
  });

  if (filter) qs.set('filter', filter);
  if (before) qs.set('before', before);
  if (since) qs.set('since', since);
  if (memberCreator !== undefined)
    qs.set('memberCreator', String(memberCreator));
  if (memberCreator_fields)
    qs.set('memberCreator_fields', memberCreator_fields);
  if (board !== undefined) qs.set('board', String(board));
  if (board_fields) qs.set('board_fields', board_fields);
  if (card !== undefined) qs.set('card', String(card));
  if (card_fields) qs.set('card_fields', card_fields);
  if (list !== undefined) qs.set('list', String(list));
  if (list_fields) qs.set('list_fields', list_fields);
  if (member !== undefined) qs.set('member', String(member));
  if (member_fields) qs.set('member_fields', member_fields);
  if (display !== undefined) qs.set('display', String(display));
  if (entities !== undefined) qs.set('entities', String(entities));
  if (reactions !== undefined) qs.set('reactions', String(reactions));
  if (page !== undefined) qs.set('page', String(page));
  if (fields) qs.set('fields', fields);

  const res = await apiFetch(apiUrl(`members/me/notificationGroups?${qs}`));
  const data = await res.json();

  const groups: { [key: string]: unknown }[] = Array.isArray(data) ? data : [];
  return { groups };
}

export async function getNotificationsCount(
  _params: GetNotificationsCountInput,
): Promise<GetNotificationsCountOutput> {
  const res = await apiFetch(apiUrl('members/me/notificationsCount'));
  const data = await res.json();

  // API returns {} when count is 0, not {count: 0} or 0
  if (typeof data === 'number') {
    return { count: data };
  }
  if (
    typeof data === 'object' &&
    data !== null &&
    typeof (data as { count?: unknown }).count === 'number'
  ) {
    return { count: (data as { count: number }).count };
  }
  return { count: 0 };
}

export async function markNotificationsRead(
  params: MarkNotificationsReadInput,
): Promise<MarkNotificationsReadOutput> {
  const { dsc: dscParam, read, ids } = params;
  const dsc = dscParam ?? getDsc();

  const body: { dsc: string; read?: boolean; ids?: string } = { dsc };
  if (read !== undefined) body.read = read;
  if (ids !== undefined && ids.length > 0) body.ids = ids.join(',');

  await apiFetch(apiUrl('notifications/all/read'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  return { success: true };
}

// ============================================================================
// Attachments
// ============================================================================

type RawAttachment = {
  id: string;
  name: string;
  url: string;
  mimeType: string;
  bytes: number | null;
  date: string;
  isUpload: boolean;
  edgeColor: string | null;
  idMember: string;
  isMalicious: boolean;
  previews: { [key: string]: unknown }[];
  sourceView: string | null;
  pos: number;
  fileName: string;
};

function mapAttachment(a: RawAttachment) {
  return {
    id: a.id,
    name: a.name,
    url: a.url,
    mimeType: a.mimeType,
    bytes: a.bytes,
    date: a.date,
    isUpload: a.isUpload,
    edgeColor: a.edgeColor,
    idMember: a.idMember,
    isMalicious: a.isMalicious,
    previews: a.previews,
    sourceView: a.sourceView,
    pos: a.pos,
    fileName: a.fileName,
  };
}

export async function listAttachments(
  params: ListAttachmentsInput,
): Promise<ListAttachmentsOutput> {
  const { cardId, filter, fields } = params;
  const qs = new URLSearchParams();
  if (filter !== undefined) qs.set('filter', filter);
  if (fields !== undefined) qs.set('fields', fields);
  const query = qs.toString();
  const url = query
    ? apiUrl(`cards/${cardId}/attachments?${query}`)
    : apiUrl(`cards/${cardId}/attachments`);
  const res = await apiFetch(url);
  const data: RawAttachment[] = await res.json();
  return { attachments: data.map(mapAttachment) };
}

export async function createAttachment(
  params: CreateAttachmentInput,
): Promise<CreateAttachmentOutput> {
  const { dsc, cardId, url, name, mimeType, setCover, pos } = params;

  const body: {
    url: string;
    dsc: string;
    name?: string;
    mimeType?: string;
    setCover?: boolean;
    pos?: string | number;
  } = {
    url,
    dsc,
  };
  if (name !== undefined) body.name = name;
  if (mimeType !== undefined) body.mimeType = mimeType;
  if (setCover !== undefined) body.setCover = setCover;
  if (pos !== undefined) body.pos = pos;

  const res = await apiFetch(apiUrl(`cards/${cardId}/attachments`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data: RawAttachment = await res.json();
  return { attachment: mapAttachment(data) };
}

export async function deleteAttachment(
  params: DeleteAttachmentInput,
): Promise<DeleteAttachmentOutput> {
  const { dsc, cardId, attachmentId } = params;

  await apiFetch(apiUrl(`cards/${cardId}/attachments/${attachmentId}`), {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dsc }),
  });

  return { success: true };
}

// ============================================================================
// Custom Fields
// ============================================================================

export async function listCustomFields(
  params: ListCustomFieldsInput,
): Promise<ListCustomFieldsOutput> {
  const url = apiUrl(`boards/${params.boardId}/customFields`);
  const res = await fetch(url, { credentials: 'include' });

  if (res.status === 403) {
    throw new PermissionDenied('Custom Fields require Trello Standard+ plan');
  }
  if (!res.ok) {
    const body = await res.text().catch(() => undefined);
    throwForStatus(res.status, body);
  }

  const data = await res.json();

  type RawOption = {
    id: string;
    idCustomField: string;
    value: { text: string };
    color: string | null;
    pos: number;
  };
  type RawField = {
    id: string;
    name: string;
    type: 'text' | 'number' | 'date' | 'checkbox' | 'list';
    pos: number;
    idModel?: string;
    modelType?: string;
    fieldGroup?: string;
    display?: { cardFront: boolean; [key: string]: unknown };
    isSuggestedField?: boolean;
    options?: RawOption[];
  };

  const customFields = (data as RawField[]).map((f) => ({
    id: f.id,
    name: f.name,
    type: f.type,
    pos: f.pos,
    ...(f.idModel !== undefined && { idModel: f.idModel }),
    ...(f.modelType !== undefined && { modelType: f.modelType }),
    ...(f.fieldGroup !== undefined && { fieldGroup: f.fieldGroup }),
    ...(f.display !== undefined && { display: f.display }),
    ...(f.isSuggestedField !== undefined && {
      isSuggestedField: f.isSuggestedField,
    }),
    options: f.options?.map((o) => ({
      id: o.id,
      idCustomField: o.idCustomField,
      value: { text: o.value.text },
      color: o.color,
      pos: o.pos,
    })),
  }));

  return { customFields };
}

export async function setCustomFieldValue(
  params: SetCustomFieldValueInput,
): Promise<SetCustomFieldValueOutput> {
  const { dsc, cardId, fieldId, value, idValue } = params;

  const url = apiUrl(`card/${cardId}/customField/${fieldId}/item`);

  // For list-type fields, idValue is a top-level body field (not inside value).
  // For all other types, value is the top-level body field.
  const body: {
    dsc: string;
    value?: Record<string, string>;
    idValue?: string;
  } = { dsc };
  if (idValue !== undefined) body.idValue = idValue;
  if (value !== undefined) body.value = value;

  const res = await fetch(url, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (res.status === 403) {
    throw new PermissionDenied('Custom Fields require Trello Standard+ plan');
  }
  if (!res.ok) {
    const errBody = await res.text().catch(() => undefined);
    throwForStatus(res.status, errBody);
  }

  const data = await res.json();
  const result: SetCustomFieldValueOutput = { success: true };
  if (data.id !== undefined) result.id = data.id;
  if (data.value !== undefined) result.value = data.value;
  if (data.idValue !== undefined) result.idValue = data.idValue;
  if (data.idCustomField !== undefined)
    result.idCustomField = data.idCustomField;
  if (data.idModel !== undefined) result.idModel = data.idModel;
  if (data.modelType !== undefined) result.modelType = data.modelType;
  return result;
}

// ============================================================================
// Bulk Operations
// ============================================================================

export async function bulkMoveCards(
  params: BulkMoveCardsInput,
): Promise<BulkMoveCardsOutput> {
  const { dsc, cardIds, idList, idBoard, pos } = params;

  if (!Array.isArray(cardIds)) {
    throw new Validation(
      'bulkMoveCards: cardIds must be an array of card ID strings',
    );
  }

  if (!idList || typeof idList !== 'string') {
    throw new Validation(
      'bulkMoveCards: idList is required and must be a non-empty string',
    );
  }

  const succeeded: string[] = [];
  const failed: { id: string; error: string }[] = [];

  for (const cardId of cardIds) {
    try {
      const body: {
        idList: string;
        dsc: string;
        idBoard?: string;
        pos?: string | number;
      } = {
        idList,
        dsc,
      };
      if (idBoard !== undefined) body.idBoard = idBoard;
      if (pos !== undefined) body.pos = pos;

      await apiFetch(apiUrl(`cards/${cardId}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      succeeded.push(cardId);
    } catch (e) {
      failed.push({
        id: cardId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    await delay(100);
  }

  return { succeeded, failed };
}

export async function bulkArchiveCards(
  params: BulkArchiveCardsInput,
): Promise<BulkArchiveCardsOutput> {
  const { dsc, cardIds, listId } = params;

  if (listId) {
    await apiFetch(apiUrl(`lists/${listId}/archiveAllCards`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dsc }),
    });
    return { succeeded: [], failed: [], allArchived: true };
  }

  if (!cardIds || cardIds.length === 0) {
    throw new Validation('Either cardIds or listId must be provided');
  }

  const succeeded: string[] = [];
  const failed: { id: string; error: string }[] = [];

  for (const cardId of cardIds) {
    try {
      await apiFetch(apiUrl(`cards/${cardId}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ closed: true, dsc }),
      });
      succeeded.push(cardId);
    } catch (e) {
      failed.push({
        id: cardId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    await delay(100);
  }

  return { succeeded, failed };
}

export async function bulkAddLabelToCards(
  params: BulkAddLabelToCardsInput,
): Promise<BulkAddLabelToCardsOutput> {
  const { dsc, cardIds, labelId } = params;

  if (!Array.isArray(cardIds)) {
    throw new Validation(
      'bulkAddLabelToCards: cardIds must be an array of card ID strings',
    );
  }

  const succeeded: string[] = [];
  const failed: { id: string; error: string }[] = [];

  for (const cardId of cardIds) {
    try {
      await apiFetch(apiUrl(`cards/${cardId}/idLabels`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: labelId, dsc }),
      });
      succeeded.push(cardId);
    } catch (e) {
      failed.push({
        id: cardId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    await delay(100);
  }

  return { succeeded, failed };
}
