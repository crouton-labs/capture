import { attioFetch } from '../helpers';
import { ContractDrift } from '@vallum/_runtime';
import type {
  CreateNoteOutput,
  ListNotesOutput,
  UpdateNoteOutput,
  DeleteNoteOutput,
} from './schemas';

interface RawNoteResponse {
  header: {
    id: string;
    note_id: string;
    parent_entity_definition_id: string;
    parent_entity_instance_id: string;
    title: string;
    created_at: string;
    created_by: { id: string; type: string };
  };
  content: unknown;
}

interface RawNoteMrl {
  id: string;
  created_at: string;
  created_by_actor_id: string;
  created_by_actor_type: string;
  parent_entity_definition_id: string | null;
  parent_entity_instance_id: string | null;
}

interface NotesMrlResponse {
  notes: RawNoteMrl[];
  accurate_at: string;
}

export async function listNotes(opts: {
  slug: string;
  parentEntityDefinitionId?: string;
  parentEntityInstanceId?: string;
}): Promise<ListNotesOutput> {
  const resp = await attioFetch<NotesMrlResponse>(
    `/api/common/workspaces/${opts.slug}/notes/mrl`,
  );

  let notes = Array.isArray(resp?.notes) ? resp.notes : [];

  if (opts.parentEntityDefinitionId !== undefined) {
    notes = notes.filter(
      (n) => n.parent_entity_definition_id === opts.parentEntityDefinitionId,
    );
  }

  if (opts.parentEntityInstanceId !== undefined) {
    notes = notes.filter(
      (n) => n.parent_entity_instance_id === opts.parentEntityInstanceId,
    );
  }

  return {
    notes: notes.map((n) => ({
      noteId: n.id,
      createdAt: n.created_at,
      createdByActorId: n.created_by_actor_id,
      parentEntityDefinitionId: n.parent_entity_definition_id ?? undefined,
      parentEntityInstanceId: n.parent_entity_instance_id ?? undefined,
    })),
  };
}

export async function createNote(opts: {
  slug: string;
  entityDefinitionId: string;
  recordId: string;
  title: string;
}): Promise<CreateNoteOutput> {
  const resp = await attioFetch<RawNoteResponse>(
    `/api/common/workspaces/${opts.slug}/notes/v2`,
    {
      method: 'POST',
      body: JSON.stringify({
        parent_entity_definition_id: opts.entityDefinitionId,
        parent_entity_instance_id: opts.recordId,
        title: opts.title,
      }),
    },
  );

  if (!resp?.header) {
    throw new ContractDrift(
      `Unexpected note creation response: ${JSON.stringify(resp)}`,
    );
  }

  return {
    noteId: resp.header.note_id ?? resp.header.id,
    title: resp.header.title,
    createdAt: resp.header.created_at,
    createdBy: resp.header.created_by?.id,
  };
}

export async function updateNote(opts: {
  slug: string;
  noteId: string;
  title: string;
}): Promise<UpdateNoteOutput> {
  const resp = await attioFetch<RawNoteResponse>(
    `/api/common/workspaces/${opts.slug}/notes/v2/${opts.noteId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ title: opts.title }),
    },
  );

  if (!resp?.header) {
    throw new ContractDrift(`Unexpected note update response: ${JSON.stringify(resp)}`);
  }

  return {
    noteId: resp.header.note_id ?? resp.header.id,
    title: resp.header.title,
    createdAt: resp.header.created_at,
  };
}

export async function deleteNote(opts: {
  slug: string;
  noteId: string;
}): Promise<DeleteNoteOutput> {
  await attioFetch<void>(
    `/api/common/workspaces/${opts.slug}/notes/v2/${opts.noteId}`,
    { method: 'DELETE' },
  );

  return { success: true };
}
