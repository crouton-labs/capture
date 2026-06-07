/**
 * Apollo Notes Module
 *
 * CRUD operations for Apollo notes. Notes can be attached to contacts, accounts, or deals.
 */

import { Validation, throwForStatus } from '@vallum/_runtime';

import type {
  CreateNoteInput,
  CreateNoteOutput,
  UpdateNoteInput,
  UpdateNoteOutput,
  DeleteNoteInput,
  DeleteNoteOutput,
} from '../schemas';

/**
 * Create a note on a contact, account, or opportunity.
 * Apollo API uses 'content' field (not 'body') and array-based association fields.
 */
export async function createNote(
  opts: CreateNoteInput,
): Promise<CreateNoteOutput> {
  const { body: noteBody, contact_id, account_id, opportunity_id } = opts;

  if (!noteBody) throw new Validation('body is required');

  const requestBody: Record<string, unknown> = {
    content: noteBody,
  };

  // Apollo API expects array-based association fields
  if (contact_id !== undefined) requestBody.contact_ids = [contact_id];
  if (account_id !== undefined) requestBody.account_ids = [account_id];
  if (opportunity_id !== undefined)
    requestBody.opportunity_ids = [opportunity_id];

  const base = window.location.origin;
  const response = await fetch(`${base}/api/v1/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  return await response.json();
}

/**
 * Update an existing note.
 */
export async function updateNote(
  opts: UpdateNoteInput,
): Promise<UpdateNoteOutput> {
  const { id, body: noteBody } = opts;

  if (!id) throw new Validation('id is required');

  const requestBody: Record<string, unknown> = {};
  if (noteBody !== undefined) requestBody.content = noteBody;

  const base = window.location.origin;
  const response = await fetch(`${base}/api/v1/notes/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  return await response.json();
}

/**
 * Delete a note by ID.
 */
export async function deleteNote(
  opts: DeleteNoteInput,
): Promise<DeleteNoteOutput> {
  const { id } = opts;

  if (!id) throw new Validation('id is required');

  const base = window.location.origin;
  const response = await fetch(`${base}/api/v1/notes/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  return { success: true };
}
