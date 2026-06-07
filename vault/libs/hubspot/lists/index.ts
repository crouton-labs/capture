/**
 * HubSpot Contact Lists Operations
 *
 * Manage HubSpot contact lists - list, retrieve, and manage list membership.
 */

import type {
  ListListsInput,
  ListListsOutput,
  GetListInput,
  GetListOutput,
  GetListContactsInput,
  GetListContactsOutput,
  CreateListInput,
  CreateListOutput,
  UpdateListInput,
  UpdateListOutput,
  DeleteListInput,
  AddToListInput,
  RemoveFromListInput,
} from '../schemas';
import { Validation, throwForStatus } from '@vallum/_runtime';

function toListObject(l: Record<string, unknown>) {
  return {
    listId: l.listId as number,
    name: l.name as string,
    listType: l.listType as 'STATIC' | 'DYNAMIC',
    dynamic: l.dynamic as boolean,
    archived: l.archived as boolean | undefined,
    createdAt: l.createdAt as number | undefined,
    updatedAt: l.updatedAt as number | undefined,
    authorId: l.authorId as number | undefined,
    ...(l.metaData
      ? {
          metaData: {
            size: (l.metaData as Record<string, unknown>).size as number,
            processing: (l.metaData as Record<string, unknown>).processing as
              | 'DONE'
              | 'PROCESSING',
          },
        }
      : {}),
  };
}

export async function listLists(
  opts: ListListsInput,
): Promise<ListListsOutput> {
  const count = opts.count ?? 25;
  const offset = opts.offset ?? 0;

  const url = new URL(`${window.location.origin}/api/contacts/v1/lists`);
  url.searchParams.set('portalId', opts.portalId);
  url.searchParams.set('count', String(count));
  if (offset > 0) {
    url.searchParams.set('offset', String(offset));
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'x-hubspot-csrf-hubspotapi': opts.csrf,
    },
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();

  return {
    offset: data.offset ?? 0,
    hasMore: data['has-more'] ?? false,
    lists: (data.lists || []).map(toListObject),
  };
}

export async function getList(opts: GetListInput): Promise<GetListOutput> {
  const url = new URL(
    `${window.location.origin}/api/contacts/v1/lists/${opts.listId}`,
  );
  url.searchParams.set('portalId', opts.portalId);

  const response = await fetch(url.toString(), {
    method: 'GET',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'x-hubspot-csrf-hubspotapi': opts.csrf,
    },
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();
  return toListObject(data);
}

export async function getListContacts(
  opts: GetListContactsInput,
): Promise<GetListContactsOutput> {
  const count = opts.count ?? 25;
  const offset = opts.offset ?? 0;

  const url = new URL(
    `${window.location.origin}/api/contacts/v1/lists/${opts.listId}/contacts/all`,
  );
  url.searchParams.set('portalId', opts.portalId);
  url.searchParams.set('count', String(count));
  if (offset > 0) {
    url.searchParams.set('offset', String(offset));
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'x-hubspot-csrf-hubspotapi': opts.csrf,
    },
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();

  const contacts = (data.contacts || []).map((c: Record<string, unknown>) => {
    const props = c.properties as Record<string, { value: string }> | undefined;
    const identities = (
      c['identity-profiles'] as Array<{
        identities: Array<{
          type: string;
          value: string;
          'is-primary'?: boolean;
        }>;
      }>
    )?.[0]?.identities;
    const primaryEmail = identities?.find(
      (i) => i.type === 'EMAIL' && i['is-primary'],
    )?.value;

    const flat: Record<string, string> = {
      id: String(c.vid),
    };
    if (primaryEmail) flat.email = primaryEmail;
    if (props) {
      for (const [key, val] of Object.entries(props)) {
        if (val?.value !== undefined && val.value !== null) {
          flat[key] = val.value;
        }
      }
    }
    if (c.addedAt) flat.addedAt = String(c.addedAt);
    return flat;
  });

  return {
    listId: opts.listId,
    contacts,
    offset: data['vid-offset'] ?? 0,
    hasMore: data['has-more'] ?? false,
  };
}

export async function createList(
  opts: CreateListInput,
): Promise<CreateListOutput> {
  const url = new URL(`${window.location.origin}/api/contacts/v1/lists`);
  url.searchParams.set('portalId', opts.portalId);

  const body: Record<string, unknown> = {
    name: opts.name,
    dynamic: opts.dynamic ?? false,
  };
  if (opts.filters && opts.filters.length > 0) {
    body.filters = opts.filters;
  }

  const response = await fetch(url.toString(), {
    method: 'POST',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-hubspot-csrf-hubspotapi': opts.csrf,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throwForStatus(response.status, text || undefined);
  }

  const data = await response.json();
  return toListObject(data);
}

export async function updateList(
  opts: UpdateListInput,
): Promise<UpdateListOutput> {
  const url = new URL(
    `${window.location.origin}/api/contacts/v1/lists/${opts.listId}`,
  );
  url.searchParams.set('portalId', opts.portalId);

  const body: Record<string, unknown> = {};
  if (opts.name !== undefined) body.name = opts.name;
  if (opts.filters !== undefined) body.filters = opts.filters;

  const response = await fetch(url.toString(), {
    method: 'POST',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-hubspot-csrf-hubspotapi': opts.csrf,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throwForStatus(response.status, text || undefined);
  }

  const data = await response.json();
  return toListObject(data);
}

export async function deleteList(
  opts: DeleteListInput,
): Promise<{ deleted: true }> {
  const url = new URL(
    `${window.location.origin}/api/contacts/v1/lists/${opts.listId}`,
  );
  url.searchParams.set('portalId', opts.portalId);

  const response = await fetch(url.toString(), {
    method: 'DELETE',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'x-hubspot-csrf-hubspotapi': opts.csrf,
    },
  });

  if (response.status !== 204 && !response.ok) {
    const text = await response.text();
    throwForStatus(response.status, text || undefined);
  }

  return { deleted: true };
}

export async function addToList(opts: AddToListInput): Promise<{
  updated: true;
  listId: number;
  addedCount: number;
}> {
  if (opts.contactIds.length === 0) {
    throw new Validation('At least one contact ID is required');
  }

  const url = new URL(
    `${window.location.origin}/api/contacts/v1/lists/${opts.listId}/add`,
  );
  url.searchParams.set('portalId', opts.portalId);

  const response = await fetch(url.toString(), {
    method: 'POST',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-hubspot-csrf-hubspotapi': opts.csrf,
    },
    body: JSON.stringify({
      vids: opts.contactIds,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throwForStatus(response.status, text || undefined);
  }

  return {
    updated: true,
    listId: opts.listId,
    addedCount: opts.contactIds.length,
  };
}

export async function removeFromList(opts: RemoveFromListInput): Promise<{
  updated: true;
  listId: number;
  removedCount: number;
}> {
  if (opts.contactIds.length === 0) {
    throw new Validation('At least one contact ID is required');
  }

  const url = new URL(
    `${window.location.origin}/api/contacts/v1/lists/${opts.listId}/remove`,
  );
  url.searchParams.set('portalId', opts.portalId);

  const response = await fetch(url.toString(), {
    method: 'POST',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-hubspot-csrf-hubspotapi': opts.csrf,
    },
    body: JSON.stringify({
      vids: opts.contactIds,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throwForStatus(response.status, text || undefined);
  }

  return {
    updated: true,
    listId: opts.listId,
    removedCount: opts.contactIds.length,
  };
}
