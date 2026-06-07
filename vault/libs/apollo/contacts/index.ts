/**
 * Apollo Contacts Module
 *
 * CRUD operations for Apollo contacts including create, update, delete,
 * stage management, and stage listing.
 */

import { Validation, throwForStatus } from '@vallum/_runtime';

import type {
  CreateContactInput,
  CreateContactOutput,
  UpdateContactInput,
  UpdateContactOutput,
  DeleteContactInput,
  DeleteContactOutput,
  UpdateContactStageInput,
  UpdateContactStageOutput,
  ListContactStagesOutput,
  ResetFinishedContactsInput,
  ResetFinishedContactsOutput,
} from '../schemas';

/**
 * Create a new contact in Apollo.
 */
export async function createContact(
  opts: CreateContactInput,
): Promise<CreateContactOutput> {
  const { first_name, last_name } = opts;

  if (!first_name) throw new Validation('first_name is required');
  if (!last_name) throw new Validation('last_name is required');

  const base = window.location.origin;
  const response = await fetch(`${base}/api/v1/contacts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(opts),
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));
  return await response.json();
}

/**
 * Update an existing contact in Apollo.
 */
export async function updateContact(
  opts: UpdateContactInput,
): Promise<UpdateContactOutput> {
  const {
    id,
    first_name,
    last_name,
    email,
    title,
    organization_name,
    phone_number,
    city,
    state,
    country,
    label_names,
    contact_stage_id,
  } = opts;

  if (!id) throw new Validation('id is required');

  const fields: Record<string, unknown> = {};
  if (first_name !== undefined) fields.first_name = first_name;
  if (last_name !== undefined) fields.last_name = last_name;
  if (email !== undefined) fields.email = email;
  if (title !== undefined) fields.title = title;
  if (organization_name !== undefined)
    fields.organization_name = organization_name;
  if (phone_number !== undefined) fields.phone_number = phone_number;
  if (city !== undefined) fields.city = city;
  if (state !== undefined) fields.state = state;
  if (country !== undefined) fields.country = country;
  if (label_names !== undefined) fields.label_names = label_names;
  if (contact_stage_id !== undefined)
    fields.contact_stage_id = contact_stage_id;

  const response = await fetch(`/api/v1/contacts/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(fields),
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));
  return await response.json();
}

/**
 * Delete a contact from Apollo.
 */
export async function deleteContact(
  opts: DeleteContactInput,
): Promise<DeleteContactOutput> {
  const { id } = opts;

  if (!id) throw new Validation('id is required');

  const response = await fetch(`/api/v1/contacts/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));
  return { success: true };
}

/**
 * Update a contact's stage.
 */
export async function updateContactStage(
  opts: UpdateContactStageInput,
): Promise<UpdateContactStageOutput> {
  const { id, contact_stage_id } = opts;

  if (!id) throw new Validation('id is required');
  if (!contact_stage_id) throw new Validation('contact_stage_id is required');

  const response = await fetch(`/api/v1/contacts/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ contact_stage_id }),
  });

  if (!response.ok)
    throwForStatus(response.status, await response.text().catch(() => undefined));
  return await response.json();
}

/**
 * List all contact stages in Apollo.
 */
export async function listContactStages(): Promise<ListContactStagesOutput> {
  const base = window.location.origin;
  const response = await fetch(`${base}/api/v1/contact_stages`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok)
    throwForStatus(response.status, await response.text().catch(() => undefined));
  return await response.json();
}

interface ContactRecord {
  id: string;
  first_name: string;
  last_name: string;
  name: string;
  email: string;
  title: string;
  organization_name: string;
  linkedin_url: string;
  person_id: string;
  label_ids: string[];
  contact_campaign_statuses: Array<{
    emailer_campaign_id: string;
    status: string;
  }>;
}

/**
 * Reset contacts marked "finished" in a sequence so they can be re-enrolled.
 * Deletes and recreates each contact to clear the finished flag.
 */
export async function resetFinishedContacts(
  opts: ResetFinishedContactsInput,
): Promise<ResetFinishedContactsOutput> {
  const { sequenceId, contactIds: specificIds } = opts;

  if (!sequenceId) throw new Validation('sequenceId is required');

  // Step 1: Get finished contacts from the sequence via mixed_people/search
  const allContacts: ContactRecord[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const seqResp = await fetch('/api/v1/mixed_people/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        page,
        per_page: 100,
        prospected_by_current_team: ['yes'],
        display_mode: 'explorer_mode',
        finder_version: 2,
        emailer_campaign_ids: [sequenceId],
        contact_campaign_statuses_or_failure_reasons: [sequenceId + 'finished'],
        context: 'emailer-campaign-show-prospects-page',
        cacheKey: Date.now(),
      }),
    });

    if (!seqResp.ok)
      throwForStatus(seqResp.status, await seqResp.text().catch(() => undefined));

    const seqData = await seqResp.json();
    const contacts: ContactRecord[] = seqData.contacts || [];
    allContacts.push(...contacts);

    const total = seqData.pagination?.total_entries ?? 0;
    hasMore = allContacts.length < total;
    page++;
  }

  // Filter to specific IDs if provided
  const targetContacts = specificIds
    ? allContacts.filter((c: ContactRecord) => specificIds.includes(c.id))
    : allContacts;

  // Only process contacts that are actually "finished" in this sequence
  const finishedContacts = targetContacts.filter((c: ContactRecord) =>
    c.contact_campaign_statuses?.some(
      (s) => s.emailer_campaign_id === sequenceId && s.status === 'finished',
    ),
  );

  const skippedCount = targetContacts.length - finishedContacts.length;
  const resetResults: Array<{
    oldId: string;
    newId: string;
    name: string;
    email: string;
  }> = [];

  // Step 2: For each finished contact, delete and recreate
  for (const contact of finishedContacts) {
    // Get full contact data before deleting
    const getResp = await fetch(`/api/v1/contacts/${contact.id}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    });

    if (!getResp.ok) continue;

    const fullData = await getResp.json();
    const c = fullData.contact;

    // Delete the contact
    const delResp = await fetch(`/api/v1/contacts/${contact.id}`, {
      method: 'DELETE',
      credentials: 'include',
    });

    if (!delResp.ok) continue;

    // Recreate from person_id to preserve Apollo database link
    const createBody: Record<string, unknown> = {
      person_id: c.person_id,
    };
    if (c.label_ids?.length) createBody.label_ids = c.label_ids;

    const createResp = await fetch('/api/v1/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(createBody),
    });

    if (!createResp.ok) continue;

    const newData = await createResp.json();
    const newContact = newData.contact;

    resetResults.push({
      oldId: contact.id,
      newId: newContact.id,
      name: newContact.name || c.name || '',
      email: newContact.email || c.email || '',
    });
  }

  return {
    resetCount: resetResults.length,
    skippedCount,
    contacts: resetResults,
  };
}
