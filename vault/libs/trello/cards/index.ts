import { apiUrl, apiFetch } from '../helpers';
import { Validation, ContractDrift } from '@vallum/_runtime';
import type {
  CreateCardInput,
  CreateCardOutput,
  DeleteCardInput,
  DeleteCardOutput,
  ListCardsInput,
  ListCardsOutput,
  GetCardInput,
  GetCardOutput,
  UpdateCardInput,
  UpdateCardOutput,
  MoveCardInput,
  MoveCardOutput,
  ArchiveCardInput,
  ArchiveCardOutput,
  ListCardsForMemberInput,
  ListCardsForMemberOutput,
} from './schemas';

// ============================================================================
// Card mapper
// ============================================================================

type RawCard = {
  id: string;
  name: string;
  desc: string;
  idList: string;
  idBoard: string;
  idMembers: string[];
  labels: { id: string; idBoard: string; name: string; color: string | null }[];
  due: string | null;
  dueComplete: boolean;
  start: string | null;
  pos: number;
  closed: boolean;
  shortLink: string;
  url: string;
  badges: {
    checkItems: number;
    checkItemsChecked: number;
    comments: number;
    attachments: number;
  };
};

function mapCard(c: RawCard) {
  return {
    id: c.id,
    name: c.name,
    desc: c.desc,
    idList: c.idList,
    idBoard: c.idBoard,
    idMembers: c.idMembers ?? [],
    labels: (c.labels ?? []).map((l) => ({
      id: l.id,
      idBoard: l.idBoard,
      name: l.name,
      color: l.color,
    })),
    due: c.due,
    dueComplete: c.dueComplete,
    start: c.start ?? null,
    pos: c.pos,
    closed: c.closed,
    shortLink: c.shortLink,
    url: c.url,
    badges: {
      checkItems: c.badges?.checkItems,
      checkItemsChecked: c.badges?.checkItemsChecked,
      comments: c.badges?.comments,
      attachments: c.badges?.attachments,
    },
  };
}

// ============================================================================
// Functions
// ============================================================================

export async function createCard(
  params: CreateCardInput,
): Promise<CreateCardOutput> {
  const {
    dsc,
    idList,
    name,
    desc,
    due,
    dueComplete,
    dueReminder,
    start,
    idMembers,
    idLabels,
    pos,
    idCardSource,
    keepFromSource,
    urlSource,
    subscribed,
    address,
    locationName,
    coordinates,
  } = params;

  if (!name || name.trim() === '') {
    throw new Validation('createCard: name is required and must not be empty');
  }

  const body: Record<string, unknown> = { idList, name, dsc };
  if (desc !== undefined) body.desc = desc;
  if (due !== undefined) body.due = due;
  if (dueComplete !== undefined) body.dueComplete = dueComplete;
  if (dueReminder !== undefined) body.dueReminder = dueReminder;
  if (start !== undefined) body.start = start;
  if (idMembers !== undefined) body.idMembers = idMembers;
  if (idLabels !== undefined) body.idLabels = idLabels;
  if (pos !== undefined) body.pos = pos;
  if (idCardSource !== undefined) body.idCardSource = idCardSource;
  if (keepFromSource !== undefined) body.keepFromSource = keepFromSource;
  if (urlSource !== undefined) body.urlSource = urlSource;
  if (subscribed !== undefined) body.subscribed = subscribed;
  if (address !== undefined) body.address = address;
  if (locationName !== undefined) body.locationName = locationName;
  if (coordinates !== undefined) body.coordinates = coordinates;

  const res = await apiFetch(apiUrl('cards'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const card = await res.json();

  return {
    card: {
      id: card.id,
      name: card.name,
      desc: card.desc,
      idList: card.idList,
      idBoard: card.idBoard,
      idMembers: card.idMembers,
      labels: (card.labels ?? []).map(
        (l: {
          id: string;
          idBoard: string;
          name: string;
          color: string | null;
        }) => ({
          id: l.id,
          idBoard: l.idBoard,
          name: l.name,
          color: l.color,
        }),
      ),
      due: card.due,
      dueComplete: card.dueComplete,
      start: card.start ?? null,
      dueReminder: card.dueReminder ?? null,
      pos: card.pos,
      closed: card.closed,
      shortLink: card.shortLink,
      url: card.url,
      badges: {
        checkItems: card.badges?.checkItems,
        checkItemsChecked: card.badges?.checkItemsChecked,
        comments: card.badges?.comments,
        attachments: card.badges?.attachments,
      },
    },
  };
}

export async function deleteCard(
  params: DeleteCardInput,
): Promise<DeleteCardOutput> {
  const { dsc, cardId } = params;

  await apiFetch(apiUrl(`cards/${cardId}`), {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dsc }),
  });

  return { success: true };
}

export async function listCards(
  params: ListCardsInput,
): Promise<ListCardsOutput> {
  const { boardId, listId, filter, limit } = params;

  if (!boardId && !listId) {
    throw new Validation(
      'listCards requires either boardId or listId; at least one must be provided.',
    );
  }

  let url: string;
  if (listId) {
    const qs = new URLSearchParams();
    if (filter !== undefined) qs.set('filter', filter);
    if (limit !== undefined) qs.set('limit', String(limit));
    const qsStr = qs.toString();
    url = apiUrl(`lists/${listId}/cards${qsStr ? `?${qsStr}` : ''}`);
  } else {
    const qs = new URLSearchParams();
    qs.set('filter', filter !== undefined ? filter : 'open');
    if (limit !== undefined) qs.set('limit', String(limit));
    url = apiUrl(`boards/${boardId}/cards?${qs.toString()}`);
  }

  const res = await apiFetch(url);
  const data = (await res.json()) as RawCard[];
  return { cards: data.map(mapCard) };
}

export async function getCard(params: GetCardInput): Promise<GetCardOutput> {
  const {
    cardId,
    fields,
    actions,
    actions_limit,
    actions_display,
    action_reactions,
    attachment_fields,
    pluginData,
    stickers,
    sticker_fields,
    checklist_fields,
    checklist_checkItems,
    member_fields,
  } = params;

  const qs = new URLSearchParams();
  qs.set('checklists', 'all');
  qs.set('attachments', 'true');
  qs.set('members', 'true');
  qs.set('customFieldItems', 'true');
  if (fields !== undefined) qs.set('fields', fields);
  if (actions !== undefined) qs.set('actions', actions);
  if (actions_limit !== undefined)
    qs.set('actions_limit', String(actions_limit));
  if (actions_display !== undefined)
    qs.set('actions_display', String(actions_display));
  if (action_reactions !== undefined)
    qs.set('action_reactions', String(action_reactions));
  if (attachment_fields !== undefined)
    qs.set('attachment_fields', attachment_fields);
  if (pluginData !== undefined) qs.set('pluginData', String(pluginData));
  if (stickers !== undefined) qs.set('stickers', String(stickers));
  if (sticker_fields !== undefined) qs.set('sticker_fields', sticker_fields);
  if (checklist_fields !== undefined)
    qs.set('checklist_fields', checklist_fields);
  if (checklist_checkItems !== undefined)
    qs.set('checklist_checkItems', checklist_checkItems);
  if (member_fields !== undefined) qs.set('member_fields', member_fields);

  const url = apiUrl(`cards/${cardId}`) + '?' + qs.toString();

  const res = await apiFetch(url);
  const c = (await res.json()) as RawCard & {
    start: string | null;
    checklists: {
      id: string;
      name: string;
      pos: number;
      idCard: string;
      checkItems: {
        id: string;
        name: string;
        state: 'incomplete' | 'complete';
        pos: number;
        due: string | null;
        idMember: string | null;
      }[];
    }[];
    attachments: {
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
    }[];
    members: {
      id: string;
      username: string;
      fullName: string;
      initials: string;
      avatarUrl: string | null;
    }[];
    actions?: {
      id: string;
      type: string;
      date: string;
      data: Record<string, unknown>;
      memberCreator: {
        id: string;
        username: string;
        fullName: string;
        initials: string;
        avatarUrl: string | null;
      };
    }[];
    pluginData?: {
      id: string;
      idPlugin: string;
      scope: string;
      idModel: string;
      value: string;
    }[];
    stickers?: {
      id: string;
      image: string;
      imageUrl: string;
      left: number;
      top: number;
      rotate: number;
      zIndex: number;
    }[];
  };

  const card = {
    ...mapCard(c),
    start: c.start,
    checklists: (c.checklists ?? []).map((cl) => ({
      id: cl.id,
      name: cl.name,
      pos: cl.pos,
      idCard: cl.idCard,
      checkItems: (cl.checkItems ?? []).map((item) => ({
        id: item.id,
        name: item.name,
        state: item.state,
        pos: item.pos,
        due: item.due,
        idMember: item.idMember,
      })),
    })),
    attachments: (c.attachments ?? []).map((a) => ({
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
    })),
    members: (c.members ?? []).map((m) => ({
      id: m.id,
      username: m.username,
      fullName: m.fullName,
      initials: m.initials,
      avatarUrl: m.avatarUrl,
    })),
    ...(c.actions !== undefined
      ? {
          actions: c.actions.map((a) => ({
            id: a.id,
            type: a.type,
            date: a.date,
            data: a.data,
            memberCreator: a.memberCreator,
          })),
        }
      : {}),
    ...(c.pluginData !== undefined
      ? {
          pluginData: c.pluginData.map((p) => ({
            id: p.id,
            idPlugin: p.idPlugin,
            scope: p.scope,
            idModel: p.idModel,
            value: p.value,
          })),
        }
      : {}),
    ...(c.stickers !== undefined
      ? {
          stickers: c.stickers.map((s) => ({
            id: s.id,
            image: s.image,
            imageUrl: s.imageUrl,
            left: s.left,
            top: s.top,
            rotate: s.rotate,
            zIndex: s.zIndex,
          })),
        }
      : {}),
  };

  return { card };
}

export async function updateCard(
  params: UpdateCardInput,
): Promise<UpdateCardOutput> {
  const {
    dsc,
    cardId,
    name,
    desc,
    due,
    dueComplete,
    dueReminder,
    start,
    closed,
    idList,
    idMembers,
    idLabels,
    pos,
    subscribed,
    cover,
    isTemplate,
    address,
    locationName,
    coordinates,
  } = params;

  const res = await apiFetch(apiUrl(`cards/${cardId}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dsc,
      ...(name !== undefined ? { name } : {}),
      ...(desc !== undefined ? { desc } : {}),
      ...(due !== undefined ? { due } : {}),
      ...(dueComplete !== undefined ? { dueComplete } : {}),
      ...(dueReminder !== undefined ? { dueReminder } : {}),
      ...(start !== undefined ? { start } : {}),
      ...(closed !== undefined ? { closed } : {}),
      ...(idList !== undefined ? { idList } : {}),
      ...(idMembers !== undefined ? { idMembers } : {}),
      ...(idLabels !== undefined ? { idLabels } : {}),
      ...(pos !== undefined ? { pos } : {}),
      ...(subscribed !== undefined ? { subscribed } : {}),
      ...(cover !== undefined ? { cover } : {}),
      ...(isTemplate !== undefined ? { isTemplate } : {}),
      ...(address !== undefined ? { address } : {}),
      ...(locationName !== undefined ? { locationName } : {}),
      ...(coordinates !== undefined ? { coordinates } : {}),
    }),
  });

  const c = (await res.json()) as RawCard;
  return { card: mapCard(c) };
}

export async function moveCard(params: MoveCardInput): Promise<MoveCardOutput> {
  const { dsc, cardId, idList, idBoard, pos } = params;

  if (!cardId) {
    throw new Validation('moveCard: cardId is required');
  }

  if (!idList) {
    throw new Validation('moveCard: idList is required');
  }

  const res = await apiFetch(apiUrl(`cards/${cardId}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idList,
      dsc,
      ...(idBoard !== undefined ? { idBoard } : {}),
      ...(pos !== undefined ? { pos } : {}),
    }),
  });

  const c = (await res.json()) as RawCard;
  return { card: mapCard(c) };
}

export async function archiveCard(
  params: ArchiveCardInput,
): Promise<ArchiveCardOutput> {
  const { dsc, cardId } = params;

  const res = await apiFetch(apiUrl(`cards/${cardId}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ closed: true, dsc }),
  });

  const c = (await res.json()) as RawCard;
  return { card: mapCard(c) };
}

type RawMemberCard = {
  id: string;
  name: string;
  idList: string;
  idBoard: string;
  idMembers: string[];
  labels: {
    id: string;
    idBoard: string;
    idOrganization: string;
    name: string;
    color: string | null;
    uses: number;
  }[];
  due: string | null;
  dueComplete: boolean;
  dueReminder: number | null;
  start: string | null;
  url: string;
  shortUrl: string;
  cardRole: string | null;
  isTemplate: boolean;
  dateLastActivity: string;
};

function mapMemberCard(c: RawMemberCard) {
  return {
    id: c.id,
    name: c.name,
    idList: c.idList,
    idBoard: c.idBoard,
    idMembers: c.idMembers ?? [],
    labels: (c.labels ?? []).map((l) => ({
      id: l.id,
      idBoard: l.idBoard,
      idOrganization: l.idOrganization,
      name: l.name,
      color: l.color,
      uses: l.uses,
    })),
    due: c.due,
    dueComplete: c.dueComplete,
    dueReminder: c.dueReminder ?? null,
    start: c.start ?? null,
    url: c.url,
    shortUrl: c.shortUrl,
    cardRole: c.cardRole ?? null,
    isTemplate: c.isTemplate,
    dateLastActivity: c.dateLastActivity,
  };
}

export async function listCardsForMember(
  params: ListCardsForMemberInput,
): Promise<ListCardsForMemberOutput> {
  const { memberId = 'me', limit, sort, dueComplete } = params;

  const qs = new URLSearchParams();
  qs.set('limit', String(limit ?? 500));
  qs.set('sort', sort ?? 'due');
  if (dueComplete !== undefined) qs.set('dueComplete', String(dueComplete));

  const url = apiUrl(`members/${memberId}/cards/query?${qs.toString()}`);
  const res = await apiFetch(url);
  const data = (await res.json()) as
    | RawMemberCard[]
    | { cards: RawMemberCard[] };

  const raw: RawMemberCard[] = Array.isArray(data) ? data : data.cards;

  if (!Array.isArray(raw)) {
    throw new ContractDrift(
      `listCardsForMember: unexpected response shape from /members/${memberId}/cards/query`,
    );
  }

  return { cards: raw.map(mapMemberCard) };
}
