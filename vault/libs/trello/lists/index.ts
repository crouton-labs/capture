import { apiUrl, apiFetch } from '../helpers';
import type {
  ListListsInput,
  ListListsOutput,
  GetListInput,
  GetListOutput,
  CreateListInput,
  CreateListOutput,
  UpdateListInput,
  UpdateListOutput,
  ArchiveListInput,
  ArchiveListOutput,
  MoveListInput,
  MoveListOutput,
} from './schemas';

// ============================================================================
// List mapper
// ============================================================================

type RawList = {
  id: string;
  name: string;
  pos: number;
  closed: boolean;
  color: string | null;
  idBoard: string;
  subscribed: boolean;
  softLimit: number | null;
  type: string | null;
  datasource: { filter: boolean };
  cards?: Record<string, unknown>[];
  board?: Record<string, unknown>;
};

function mapList(l: RawList) {
  return {
    id: l.id,
    name: l.name,
    pos: l.pos,
    closed: l.closed,
    color: l.color,
    idBoard: l.idBoard,
    subscribed: l.subscribed,
    softLimit: l.softLimit,
    type: l.type,
    datasource: l.datasource,
    ...(l.cards !== undefined ? { cards: l.cards } : {}),
    ...(l.board !== undefined ? { board: l.board } : {}),
  };
}

// ============================================================================
// Functions
// ============================================================================

export async function listLists(
  params: ListListsInput,
): Promise<ListListsOutput> {
  const filter = params.filter ?? 'open';
  const qs = new URLSearchParams({ filter });
  if (params.fields !== undefined) qs.set('fields', params.fields);
  if (params.cards !== undefined) qs.set('cards', params.cards);
  if (params.card_fields !== undefined)
    qs.set('card_fields', params.card_fields);

  const res = await apiFetch(
    apiUrl(`boards/${params.boardId}/lists?${qs.toString()}`),
  );
  const data = await res.json();

  const lists = (data as RawList[]).map(mapList);

  return { lists };
}

export async function getList(params: GetListInput): Promise<GetListOutput> {
  const qs = new URLSearchParams();
  // Default to all fields needed by ListSchema; caller can override
  qs.set(
    'fields',
    params.fields ??
      'id,name,pos,closed,color,idBoard,subscribed,softLimit,type,datasource',
  );
  if (params.board !== undefined) qs.set('board', String(params.board));
  if (params.board_fields !== undefined)
    qs.set('board_fields', params.board_fields);
  if (params.cards !== undefined) qs.set('cards', params.cards);
  if (params.card_fields !== undefined)
    qs.set('card_fields', params.card_fields);

  const res = await apiFetch(apiUrl(`lists/${params.listId}?${qs.toString()}`));
  const l = (await res.json()) as RawList;
  return { list: mapList(l) };
}

export async function createList(
  params: CreateListInput,
): Promise<CreateListOutput> {
  const { dsc, idBoard, name, pos, color, idListSource } = params;

  const res = await apiFetch(apiUrl('lists'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idBoard,
      name,
      dsc,
      ...(pos !== undefined ? { pos } : {}),
      ...(color !== undefined ? { color } : {}),
      ...(idListSource !== undefined ? { idListSource } : {}),
    }),
  });

  const created = (await res.json()) as { id: string };

  // POST /1/lists does not return subscribed/softLimit; fetch full object
  const fullRes = await apiFetch(
    apiUrl(
      `lists/${created.id}?fields=id,name,pos,closed,color,idBoard,subscribed,softLimit,type,datasource`,
    ),
  );
  const l = (await fullRes.json()) as RawList;
  return { list: mapList(l) };
}

export async function updateList(
  params: UpdateListInput,
): Promise<UpdateListOutput> {
  const { dsc, listId, name, pos, color, subscribed, softLimit, closed } =
    params;

  await apiFetch(apiUrl(`lists/${listId}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dsc,
      ...(name !== undefined ? { name } : {}),
      ...(pos !== undefined ? { pos } : {}),
      ...(color !== undefined ? { color } : {}),
      ...(subscribed !== undefined ? { subscribed } : {}),
      ...(softLimit !== undefined ? { softLimit } : {}),
      ...(closed !== undefined ? { closed } : {}),
    }),
  });

  // PUT /1/lists/:id does not return subscribed/softLimit/type/datasource; fetch full object
  const fullRes = await apiFetch(
    apiUrl(
      `lists/${listId}?fields=id,name,pos,closed,color,idBoard,subscribed,softLimit,type,datasource`,
    ),
  );
  const l = (await fullRes.json()) as RawList;
  return { list: mapList(l) };
}

export async function archiveList(
  params: ArchiveListInput,
): Promise<ArchiveListOutput> {
  const { dsc, listId, value = true } = params;

  await apiFetch(apiUrl(`lists/${listId}/closed`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value, dsc }),
  });

  // PUT /1/lists/:id/closed does not return subscribed/softLimit; fetch full object
  const fullRes = await apiFetch(
    apiUrl(
      `lists/${listId}?fields=id,name,pos,closed,color,idBoard,subscribed,softLimit,type,datasource`,
    ),
  );
  const l = (await fullRes.json()) as RawList;
  return { list: mapList(l) };
}

export async function moveList(params: MoveListInput): Promise<MoveListOutput> {
  const { dsc, listId, targetBoardId, pos } = params;

  await apiFetch(apiUrl(`lists/${listId}/idBoard`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      value: targetBoardId,
      dsc,
      ...(pos !== undefined ? { pos } : {}),
    }),
  });

  // PUT /1/lists/:id/idBoard does not return subscribed/softLimit; fetch full object
  const fullRes = await apiFetch(
    apiUrl(
      `lists/${listId}?fields=id,name,pos,closed,color,idBoard,subscribed,softLimit,type,datasource`,
    ),
  );
  const l = (await fullRes.json()) as RawList;
  return { list: mapList(l) };
}
