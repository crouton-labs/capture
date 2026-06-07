import { apiUrl, apiFetch } from '../helpers';
import type {
  ListChecklistsInput,
  ListChecklistsOutput,
  GetChecklistInput,
  GetChecklistOutput,
  CreateChecklistInput,
  CreateChecklistOutput,
  UpdateChecklistInput,
  UpdateChecklistOutput,
  DeleteChecklistInput,
  DeleteChecklistOutput,
  CreateCheckItemInput,
  CreateCheckItemOutput,
  UpdateCheckItemInput,
  UpdateCheckItemOutput,
  DeleteCheckItemInput,
  DeleteCheckItemOutput,
} from './schemas';

// ============================================================================
// Response Shape
// ============================================================================

interface RawCheckItem {
  id: string;
  name: string;
  nameData: { emoji: Record<string, unknown>; [key: string]: unknown };
  state: 'complete' | 'incomplete';
  pos: number;
  due: string | null;
  dueReminder: number | null;
  idMember: string | null;
  idChecklist: string;
  creationMethod: string | null;
  [key: string]: unknown;
}

interface RawChecklist {
  id: string;
  name: string;
  pos: number;
  idCard: string;
  idBoard: string;
  checkItems: RawCheckItem[];
  [key: string]: unknown;
}

function mapCheckItem(
  item: RawCheckItem,
): GetChecklistOutput['checklist']['checkItems'][number] {
  return { ...item };
}

function mapChecklist(c: RawChecklist): GetChecklistOutput['checklist'] {
  return {
    ...c,
    checkItems: (c.checkItems ?? []).map(mapCheckItem),
  };
}

// ============================================================================
// Functions
// ============================================================================

export async function listChecklists(
  params: ListChecklistsInput,
): Promise<ListChecklistsOutput> {
  const { cardId, fields } = params;

  const qs = new URLSearchParams();
  if (fields !== undefined) qs.set('fields', fields);
  const query = qs.toString();

  const res = await apiFetch(
    apiUrl(`cards/${cardId}/checklists${query ? `?${query}` : ''}`),
  );
  const data: RawChecklist[] = await res.json();

  return { checklists: data.map(mapChecklist) };
}

export async function getChecklist(
  params: GetChecklistInput,
): Promise<GetChecklistOutput> {
  const { checklistId, checkItems, fields, checkItem_fields } = params;

  const qs = new URLSearchParams();
  qs.set('checkItems', checkItems ?? 'all');
  if (fields !== undefined) qs.set('fields', fields);
  if (checkItem_fields !== undefined)
    qs.set('checkItem_fields', checkItem_fields);

  const res = await apiFetch(
    apiUrl(`checklists/${checklistId}?${qs.toString()}`),
  );
  const data: RawChecklist = await res.json();

  return { checklist: mapChecklist(data) };
}

export async function createChecklist(
  params: CreateChecklistInput,
): Promise<CreateChecklistOutput> {
  const { dsc, idCard, name, pos, idChecklistSource, keepFromSource, idBoard } =
    params;

  const body: Record<string, unknown> = { idCard, name, dsc };
  if (pos !== undefined) body.pos = pos;
  if (idChecklistSource !== undefined)
    body.idChecklistSource = idChecklistSource;
  if (keepFromSource !== undefined) body.keepFromSource = keepFromSource;
  if (idBoard !== undefined) body.idBoard = idBoard;

  const res = await apiFetch(apiUrl('checklists'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data: RawChecklist = await res.json();
  return { checklist: mapChecklist(data) };
}

export async function updateChecklist(
  params: UpdateChecklistInput,
): Promise<UpdateChecklistOutput> {
  const { dsc, checklistId, name, pos } = params;

  const body: Record<string, unknown> = { dsc };
  if (name !== undefined) body.name = name;
  if (pos !== undefined) body.pos = pos;

  const res = await apiFetch(apiUrl(`checklists/${checklistId}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data: RawChecklist = await res.json();
  return { checklist: mapChecklist(data) };
}

export async function deleteChecklist(
  params: DeleteChecklistInput,
): Promise<DeleteChecklistOutput> {
  const { dsc, checklistId } = params;

  await apiFetch(apiUrl(`checklists/${checklistId}`), {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dsc }),
  });

  return { success: true };
}

export async function createCheckItem(
  params: CreateCheckItemInput,
): Promise<CreateCheckItemOutput> {
  const { dsc, checklistId, name, pos, checked, due, dueReminder, idMember } =
    params;

  const body: Record<string, unknown> = { name, dsc };
  if (pos !== undefined) body.pos = pos;
  if (checked !== undefined) body.checked = checked;
  if (due !== undefined) body.due = due;
  if (dueReminder !== undefined) body.dueReminder = dueReminder;
  if (idMember !== undefined) body.idMember = idMember;

  const res = await apiFetch(apiUrl(`checklists/${checklistId}/checkItems`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const item: RawCheckItem = await res.json();
  return { checkItem: mapCheckItem(item) };
}

export async function updateCheckItem(
  params: UpdateCheckItemInput,
): Promise<UpdateCheckItemOutput> {
  const {
    dsc,
    cardId,
    checklistId,
    checkItemId,
    name,
    state,
    pos,
    due,
    idMember,
    dueReminder,
    idChecklist,
  } = params;

  const body: Record<string, unknown> = { dsc };
  if (name !== undefined) body.name = name;
  if (state !== undefined) body.state = state;
  if (pos !== undefined) body.pos = pos;
  if (due !== undefined) body.due = due === null ? '' : due;
  if (idMember !== undefined) body.idMember = idMember === null ? '' : idMember;
  if (dueReminder !== undefined) body.dueReminder = dueReminder;
  if (idChecklist !== undefined) body.idChecklist = idChecklist;

  const res = await apiFetch(
    apiUrl(`cards/${cardId}/checklist/${checklistId}/checkItem/${checkItemId}`),
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );

  const item: RawCheckItem = await res.json();
  return { checkItem: mapCheckItem(item) };
}

export async function deleteCheckItem(
  params: DeleteCheckItemInput,
): Promise<DeleteCheckItemOutput> {
  const { dsc, checklistId, checkItemId } = params;

  await apiFetch(
    apiUrl(`checklists/${checklistId}/checkItems/${checkItemId}`),
    {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dsc }),
    },
  );

  return { success: true };
}
