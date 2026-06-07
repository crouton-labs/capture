import { apiUrl, apiFetch } from '../helpers';
import { Validation } from '@vallum/_runtime';
import type {
  ListLabelsInput,
  ListLabelsOutput,
  AddLabelToCardInput,
  AddLabelToCardOutput,
  CreateLabelInput,
  CreateLabelOutput,
  UpdateLabelInput,
  UpdateLabelOutput,
  DeleteLabelInput,
  DeleteLabelOutput,
  RemoveLabelFromCardInput,
  RemoveLabelFromCardOutput,
} from './schemas';

export async function listLabels(
  params: ListLabelsInput,
): Promise<ListLabelsOutput> {
  const qs = new URLSearchParams();
  if (params.limit !== undefined) {
    if (params.limit < 1)
      throw new Validation('listLabels: limit must be >= 1, got ' + params.limit);
    qs.set('limit', String(params.limit));
  }
  if (params.fields !== undefined) qs.set('fields', params.fields);
  const query = qs.toString();
  const url = apiUrl(
    `boards/${params.boardId}/labels${query ? `?${query}` : ''}`,
  );
  const res = await apiFetch(url);
  const data = await res.json();

  const labels = data.map(
    (l: {
      id: string;
      name: string;
      color: string | null;
      idBoard: string;
      uses: number;
    }) => ({
      id: l.id,
      name: l.name,
      color: l.color,
      idBoard: l.idBoard,
      uses: l.uses,
    }),
  );

  return { labels };
}

export async function addLabelToCard(
  params: AddLabelToCardInput,
): Promise<AddLabelToCardOutput> {
  const { dsc, cardId, labelId } = params;

  const res = await apiFetch(apiUrl(`cards/${cardId}/idLabels`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: labelId, dsc }),
  });

  const data = await res.json();
  const labelIds: string[] = Array.isArray(data) ? data : [];

  return { labelIds };
}

export async function createLabel(
  params: CreateLabelInput,
): Promise<CreateLabelOutput> {
  const { dsc, idBoard, name, color } = params;

  const body: Record<string, unknown> = { name, idBoard, dsc };
  // color can be null (no color); include it explicitly either way
  body.color = color;

  const res = await apiFetch(apiUrl('labels'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const label = await res.json();

  return {
    label: {
      id: label.id,
      name: label.name,
      color: label.color,
      idBoard: label.idBoard,
      uses: label.uses,
    },
  };
}

export async function updateLabel(
  params: UpdateLabelInput,
): Promise<UpdateLabelOutput> {
  const { dsc, labelId, name, color } = params;

  const body: Record<string, unknown> = { dsc };
  if (name !== undefined) body.name = name;
  if (color !== undefined) body.color = color;

  const res = await apiFetch(apiUrl(`labels/${labelId}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const label = await res.json();

  return {
    label: {
      id: label.id,
      name: label.name,
      color: label.color,
      idBoard: label.idBoard,
      uses: label.uses,
    },
  };
}

export async function deleteLabel(
  params: DeleteLabelInput,
): Promise<DeleteLabelOutput> {
  const { dsc, labelId } = params;

  await apiFetch(apiUrl(`labels/${labelId}`), {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dsc }),
  });

  return { success: true };
}

export async function removeLabelFromCard(
  params: RemoveLabelFromCardInput,
): Promise<RemoveLabelFromCardOutput> {
  const { dsc, cardId, labelId } = params;

  await apiFetch(apiUrl(`cards/${cardId}/idLabels/${labelId}`), {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dsc }),
  });

  return { success: true };
}
