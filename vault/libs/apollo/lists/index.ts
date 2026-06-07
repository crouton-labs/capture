/**
 * Apollo Lists Module
 *
 * CRUD operations for Apollo lists (labels) including create, view, delete,
 * and managing contacts/companies within lists.
 */

import { RateLimited, UpstreamError, Validation, throwForStatus } from '@vallum/_runtime';

import type {
  CreateListOutput,
  ViewListsOutput,
  UpdateListOutput,
  AddContactsToListOutput,
  AddCompaniesToListOutput,
  DeleteListOutput,
  RemoveContactsFromListOutput,
  RemoveCompaniesFromListOutput,
  GetContactsInListOutput,
  GetAccountsInListOutput,
} from '../schemas';

/**
 * Create a new list in Apollo.
 * Creates a contacts or accounts list for organizing prospects.
 */
export async function createList(opts: {
  name: string;
  modality?: 'contacts' | 'accounts';
}): Promise<CreateListOutput> {
  const { name, modality = 'contacts' } = opts;

  if (!name) {
    throw new Validation('List name is required');
  }

  if (!['contacts', 'accounts'].includes(modality)) {
    throw new Validation(
      `Invalid modality: ${modality}. Valid options: contacts, accounts`,
    );
  }

  const base = window.location.origin;
  const response = await fetch(`${base}/api/v1/labels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      name: name,
      modality: modality,
      cacheKey: Date.now(),
    }),
  });

  const data = await response.json();

  return {
    id: data.label ? data.label.id : data.id,
    name: data.label ? data.label.name : data.name,
    modality: data.label ? data.label.modality : data.modality,
  };
}

/**
 * View all saved lists in Apollo.
 * Returns lists with pagination. Can filter by modality.
 */
export async function viewLists(
  opts: {
    modality?: 'contacts' | 'accounts';
    page?: number;
    perPage?: number;
  } = {},
): Promise<ViewListsOutput> {
  const { modality, page = 1, perPage = 100 } = opts;

  const searchBody: Record<string, unknown> = {
    page: page,
    per_page: perPage,
  };

  if (modality) {
    if (!['contacts', 'accounts'].includes(modality)) {
      throw new Validation(
        `Invalid modality: ${modality}. Valid options: contacts, accounts`,
      );
    }
    searchBody.label_modality = modality;
  }

  const base = window.location.origin;
  const response = await fetch(`${base}/api/v1/labels/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(searchBody),
  });

  return await response.json();
}

/**
 * Add contacts/people to a list by name.
 * Creates the list if it doesn't exist.
 * Saves net-new contacts to CRM in the process.
 */
export async function addContactsToList(opts: {
  listName: string;
  contactIds: string[];
}): Promise<AddContactsToListOutput> {
  const { listName, contactIds } = opts;

  if (!listName) {
    throw new Validation('listName is required');
  }

  if (!contactIds || contactIds.length === 0) {
    throw new Validation('contactIds array is required and must not be empty');
  }

  const batchSize = 25;
  let totalAdded = 0;
  const savedContactIds: string[] = [];
  const base = window.location.origin;

  for (let i = 0; i < contactIds.length; i += batchSize) {
    const batch = contactIds.slice(i, i + batchSize);

    const response = await fetch(
      `${base}/api/v1/mixed_people/add_to_my_prospects`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          entity_ids: batch,
          label_names: [listName],
          async: false,
          cacheKey: Date.now(),
        }),
      },
    );

    if (!response.ok) {
      let body: Record<string, unknown> | undefined;
      try {
        body = await response.json();
      } catch {
        /* not JSON */
      }

      if (response.status === 422 && body?.code === 'credit_limit') {
        const remaining =
          (body as { num_credits_remaining?: number }).num_credits_remaining ??
          0;
        const requested = batch.length;
        throw new RateLimited(
          `addContactsToList: insufficient credits (need ${requested}, have ${remaining}). ` +
            `Reduce the number of contacts or ask the user to add credits in Apollo.`,
        );
      }

      const detail = body ? `: ${JSON.stringify(body)}` : '';
      throw new UpstreamError(`addContactsToList failed: ${response.status}${detail}`);
    }
    const data = await response.json();

    if (data.contacts && data.contacts.length > 0) {
      totalAdded += data.contacts.length;
      for (const c of data.contacts) {
        if (c.id) savedContactIds.push(c.id);
      }
    }

    // Apollo's sync mode locks the list briefly; wait between batches to avoid 422
    if (i + batchSize < contactIds.length) {
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  // Look up the list ID so the caller can use it for getContactsInList/removeContactsFromList
  const listsResponse = await fetch(`${base}/api/v1/labels/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ page: 1, per_page: 200 }),
  });
  let listId: string | undefined;
  if (listsResponse.ok) {
    const listsData = await listsResponse.json();
    const match = (listsData.labels || []).find(
      (l: { name: string; id: string }) => l.name === listName,
    );
    if (match) listId = match.id;
  }

  return {
    success: totalAdded > 0,
    addedCount: totalAdded,
    listName: listName,
    listId: listId ?? '',
    contactIds: contactIds,
    savedContactIds: savedContactIds,
  };
}

/**
 * Add companies/accounts to a list by name.
 * Creates the list if it doesn't exist.
 * Saves net-new companies to CRM in the process.
 */
export async function addCompaniesToList(opts: {
  listName: string;
  companyIds: string[];
}): Promise<AddCompaniesToListOutput> {
  const { listName, companyIds } = opts;

  if (!listName) {
    throw new Validation('listName is required');
  }

  if (!companyIds || companyIds.length === 0) {
    throw new Validation('companyIds array is required and must not be empty');
  }

  const base = window.location.origin;

  // Batch companies in groups of 25 to avoid rate limits
  const batchSize = 25;
  let totalAdded = 0;
  const allSavedAccountIds: string[] = [];

  for (let i = 0; i < companyIds.length; i += batchSize) {
    const batch = companyIds.slice(i, i + batchSize);

    const response = await fetch(
      `${base}/api/v1/mixed_companies/add_to_my_prospects`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          entity_ids: batch,
          visible_entity_ids: batch,
          label_names: [listName],
          modality: 'accounts',
          async: false,
          cacheKey: Date.now(),
        }),
      },
    );

    if (!response.ok)
      throwForStatus(response.status, await response.text().catch(() => undefined));
    const data = await response.json();
    const accounts = data.accounts || [];
    totalAdded += accounts.length || batch.length;
    for (const acct of accounts) {
      if (acct.id) allSavedAccountIds.push(acct.id);
    }

    // Rate limit delay between batches
    if (i + batchSize < companyIds.length) {
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  // Look up the list ID so the caller can use it for getAccountsInList/removeCompaniesFromList
  const listsResponse = await fetch(`${base}/api/v1/labels/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      page: 1,
      per_page: 200,
      label_modality: 'accounts',
    }),
  });
  let listId: string | undefined;
  if (listsResponse.ok) {
    const listsData = await listsResponse.json();
    const match = (listsData.labels || []).find(
      (l: { name: string; id: string }) => l.name === listName,
    );
    if (match) listId = match.id;
  }

  return {
    success: totalAdded > 0,
    addedCount: totalAdded,
    listName: listName,
    listId: listId ?? '',
    companyIds: companyIds,
    savedAccountIds: allSavedAccountIds,
  };
}

/**
 * Update a list (rename).
 */
export async function updateList(opts: {
  id: string;
  name: string;
}): Promise<UpdateListOutput> {
  const { id, name } = opts;

  if (!id) throw new Validation('id is required');
  if (!name) throw new Validation('name is required');

  const response = await fetch(`/api/v1/labels/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ name }),
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();
  const label = data.label || data;

  return {
    id: label.id,
    name: label.name,
    modality: label.modality,
  };
}

/**
 * Delete a list (label) from Apollo.
 */
export async function deleteList(opts: {
  id: string;
}): Promise<DeleteListOutput> {
  const { id } = opts;

  if (!id) throw new Validation('id is required');

  const response = await fetch(`/api/v1/labels/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));
  return { success: true };
}

/**
 * Remove contacts from a list.
 */
export async function removeContactsFromList(opts: {
  listId: string;
  contactIds: string[];
}): Promise<RemoveContactsFromListOutput> {
  const { listId, contactIds } = opts;

  if (!listId) throw new Validation('listId is required');
  if (!contactIds || contactIds.length === 0)
    throw new Validation('contactIds is required and must not be empty');

  for (const contactId of contactIds) {
    const getResponse = await fetch(`/api/v1/contacts/${contactId}`, {
      credentials: 'include',
    });
    if (!getResponse.ok)
      throwForStatus(getResponse.status, await getResponse.text().catch(() => undefined));
    const data = await getResponse.json();
    const currentLabels: string[] = data.contact?.label_ids || [];
    const newLabels = currentLabels.filter((id: string) => id !== listId);

    const updateResponse = await fetch(`/api/v1/contacts/${contactId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ label_ids: newLabels }),
    });
    if (!updateResponse.ok)
      throwForStatus(updateResponse.status, await updateResponse.text().catch(() => undefined));
  }

  return { success: true };
}

/**
 * Remove companies/accounts from a list.
 */
export async function removeCompaniesFromList(opts: {
  listId: string;
  accountIds: string[];
}): Promise<RemoveCompaniesFromListOutput> {
  const { listId, accountIds } = opts;

  if (!listId) throw new Validation('listId is required');
  if (!accountIds || accountIds.length === 0)
    throw new Validation('accountIds is required and must not be empty');

  for (const accountId of accountIds) {
    const getResponse = await fetch(`/api/v1/accounts/${accountId}`, {
      credentials: 'include',
    });
    if (!getResponse.ok)
      throwForStatus(getResponse.status, await getResponse.text().catch(() => undefined));
    const data = await getResponse.json();
    const currentLabels: string[] = data.account?.label_ids || [];
    const newLabels = currentLabels.filter((id: string) => id !== listId);

    const updateResponse = await fetch(`/api/v1/accounts/${accountId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ label_ids: newLabels }),
    });
    if (!updateResponse.ok)
      throwForStatus(updateResponse.status, await updateResponse.text().catch(() => undefined));
  }

  return { success: true };
}

/**
 * Get contacts in a list by list ID.
 * Returns CRM contact IDs and basic contact info.
 */
export async function getContactsInList(opts: {
  listId: string;
  page?: number;
  perPage?: number;
}): Promise<GetContactsInListOutput> {
  const { listId, page = 1, perPage = 25 } = opts;

  if (!listId) throw new Validation('listId is required');

  const base = window.location.origin;
  const response = await fetch(`${base}/api/v1/mixed_people/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      page,
      per_page: perPage,
      contact_label_ids: [listId],
      prospected_by_current_team: ['yes'],
      display_mode: 'explorer_mode',
      finder_version: 2,
      context: 'people-index-page',
      cacheKey: Date.now(),
    }),
  });

  if (!response.ok)
    throwForStatus(response.status, await response.text().catch(() => undefined));
  const data = await response.json();

  const contacts = data.contacts || [];

  return {
    contacts: contacts.map(
      (c: {
        id: string;
        name?: string;
        title?: string;
        organization_name?: string;
        organization?: { name?: string };
        email?: string;
      }) => ({
        id: c.id,
        name: c.name || '',
        title: c.title || '',
        company: c.organization_name || c.organization?.name || '',
        email: c.email || '',
      }),
    ),
    contactIds: contacts.map((c: { id: string }) => c.id),
    pagination: data.pagination,
  };
}

/**
 * Get accounts/companies in a list by list ID.
 * Returns CRM account IDs and basic account info.
 */
export async function getAccountsInList(opts: {
  listId: string;
  page?: number;
  perPage?: number;
}): Promise<GetAccountsInListOutput> {
  const { listId, page = 1, perPage = 25 } = opts;

  if (!listId) throw new Validation('listId is required');

  const base = window.location.origin;
  const response = await fetch(`${base}/api/v1/mixed_companies/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      page,
      per_page: perPage,
      account_label_ids: [listId],
      prospected_by_current_team: ['yes'],
      display_mode: 'explorer_mode',
      finder_version: 2,
      context: 'companies-index-page',
      cacheKey: Date.now(),
    }),
  });

  if (!response.ok)
    throwForStatus(response.status, await response.text().catch(() => undefined));
  const data = await response.json();

  const accounts = data.accounts || [];

  return {
    accounts: accounts.map(
      (a: {
        id: string;
        name?: string;
        domain?: string;
        industry?: string;
      }) => ({
        id: a.id,
        name: a.name || '',
        domain: a.domain || '',
        industry: a.industry || '',
      }),
    ),
    accountIds: accounts.map((a: { id: string }) => a.id),
    pagination: data.pagination,
  };
}
