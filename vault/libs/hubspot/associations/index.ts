/**
 * HubSpot Association Operations
 *
 * Manage relationships between CRM objects.
 */

import { Validation, throwForStatus } from '@vallum/_runtime';

export interface AssociationLabel {
  category: string;
  typeId: number;
  label: string;
}

const OBJECT_TYPE_IDS: Record<string, string> = {
  contacts: '0-1',
  companies: '0-2',
  deals: '0-3',
  tickets: '0-5',
};

const DEFAULT_PROPERTIES: Record<string, string[]> = {
  contacts: [
    'firstname',
    'lastname',
    'email',
    'jobtitle',
    'phone',
    'lifecyclestage',
    'createdate',
  ],
  companies: [
    'name',
    'domain',
    'industry',
    'city',
    'phone',
    'lifecyclestage',
    'createdate',
  ],
  deals: [
    'dealname',
    'amount',
    'dealstage',
    'closedate',
    'pipeline',
    'createdate',
  ],
  tickets: [
    'subject',
    'content',
    'hs_pipeline_stage',
    'hs_ticket_priority',
    'createdate',
  ],
};

/**
 * Get associated objects with full details using the chirp gateway.
 * Returns flattened object records (properties as top-level fields).
 */
export async function getAssociations(opts: {
  csrf: string;
  portalId: string;
  objectType: string;
  objectId: string;
  toObjectType: string;
  properties?: string[];
  count?: number;
  offset?: number;
}): Promise<{
  total: number;
  hasMore: boolean;
  offset: number;
  results: Array<{ id: string; [key: string]: string }>;
}> {
  const fromTypeId = OBJECT_TYPE_IDS[opts.objectType];
  if (!fromTypeId) {
    throw new Validation(
      `Unknown objectType "${opts.objectType}". Use: contacts, companies, deals, tickets`,
    );
  }

  const toTypeId = OBJECT_TYPE_IDS[opts.toObjectType];
  if (!toTypeId) {
    throw new Validation(
      `Unknown toObjectType "${opts.toObjectType}". Use: contacts, companies, deals, tickets`,
    );
  }

  const properties =
    opts.properties ?? DEFAULT_PROPERTIES[opts.toObjectType] ?? [];
  const pageLength = opts.count ?? 100;
  const offset = opts.offset ?? 0;

  const url = `${window.location.origin}/api/chirp-frontend-app/v1/gateway/com.hubspot.card.associated.objects.rpc.AssociatedObjectsGatewayRpc/getAssociatedObjectsPaged?portalId=${opts.portalId}&clienttimeout=5000`;

  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-hubspot-csrf-hubspotapi': opts.csrf,
    },
    body: JSON.stringify({
      fromObjectTypeId: fromTypeId,
      fromObjectId: Number(opts.objectId),
      toObjectTypeId: toTypeId,
      propertyNames: properties,
      locale: 'EN',
      sorts: [{ property: 'createdate', order: 'DESC', missing: '_last' }],
      filterGroups: [],
      query: '',
      isPrimaryFirst: true,
      pageLength,
      offset,
    }),
  });

  if (!response.ok) {
    throwForStatus(response.status, await response.text().catch(() => undefined));
  }

  const data = await response.json();
  const page = data.data ?? data;

  interface ChirpResult {
    objectId: number;
    properties: Array<{ name: string; value: string }>;
  }

  const results = (page.results ?? []).map((r: ChirpResult) => {
    const record: Record<string, string> = { id: String(r.objectId) };
    (r.properties ?? []).forEach((p: { name: string; value: string }) => {
      record[p.name] = p.value;
    });
    return record;
  });

  return {
    total: page.total ?? results.length,
    hasMore: page.hasMore ?? false,
    offset: page.offset ?? offset + results.length,
    results,
  };
}

/**
 * Get available association type labels between two object types.
 * Returns the types of associations that can exist between the specified object types.
 */
export async function getAssociationLabels(opts: {
  csrf: string;
  portalId: string;
  objectType: string;
  toObjectType: string;
}): Promise<AssociationLabel[]> {
  const url = new URL(
    `${window.location.origin}/api/crm/v4/associations/${opts.objectType}/${opts.toObjectType}/labels`,
  );
  url.searchParams.set('portalId', opts.portalId);

  const response = await fetch(url.toString(), {
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'x-hubspot-csrf-hubspotapi': opts.csrf,
    },
  });

  if (!response.ok) {
    throwForStatus(response.status, await response.text().catch(() => undefined));
  }

  const data: { results: AssociationLabel[] } = await response.json();
  return data.results ?? [];
}

/**
 * Create an association between two objects.
 * Establishes a relationship of the specified type between two CRM objects.
 */
export async function createAssociation(opts: {
  csrf: string;
  portalId: string;
  objectType: string;
  objectId: string;
  toObjectType: string;
  toObjectId: string;
  associationType: number;
}): Promise<void> {
  const url = new URL(
    `${window.location.origin}/api/crm/v3/objects/${opts.objectType}/${opts.objectId}/associations/${opts.toObjectType}/${opts.toObjectId}/${opts.associationType}`,
  );
  url.searchParams.set('portalId', opts.portalId);

  const response = await fetch(url.toString(), {
    method: 'PUT',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'x-hubspot-csrf-hubspotapi': opts.csrf,
    },
  });

  if (!response.ok) {
    throwForStatus(response.status, await response.text().catch(() => undefined));
  }
}

/**
 * Delete an association between two objects.
 * Removes a relationship of the specified type between two CRM objects.
 */
export async function deleteAssociation(opts: {
  csrf: string;
  portalId: string;
  objectType: string;
  objectId: string;
  toObjectType: string;
  toObjectId: string;
  associationType: number;
}): Promise<void> {
  const url = new URL(
    `${window.location.origin}/api/crm/v3/objects/${opts.objectType}/${opts.objectId}/associations/${opts.toObjectType}/${opts.toObjectId}/${opts.associationType}`,
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

  if (!response.ok) {
    throwForStatus(response.status, await response.text().catch(() => undefined));
  }
}
