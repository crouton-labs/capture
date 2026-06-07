/**
 * HubSpot Ticket Operations
 *
 * CRUD operations for HubSpot tickets.
 */

import type { CreateTicketInput, CreateTicketOutput } from '../schemas';
import { ContractDrift, throwForStatus } from '@vallum/_runtime';

function toEpochMs(val: string): string {
  if (/^\d+$/.test(val)) return val;
  const ms = new Date(val).getTime();
  if (isNaN(ms)) return val;
  return String(ms);
}

function convertDateProps(
  props: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(props)) {
    out[k] = k.includes('date') ? toEpochMs(v) : v;
  }
  return out;
}

export async function listTickets(opts: {
  csrf: string;
  portalId: string;
  count?: number;
  offset?: number;
}): Promise<{
  total: number;
  offset: number;
  count: number;
  tickets: Array<{
    id: string;
    [key: string]: string;
  }>;
}> {
  const count = opts.count ?? 25;
  const offset = opts.offset ?? 0;

  const url = new URL(`${window.location.origin}/api/graphql/crm`);
  url.searchParams.set('hs_static_app', 'crm-index-ui');
  url.searchParams.set('hs_static_app_version', '2.50992');
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
      operationName: 'CrmObjectsSearchQuery',
      query: `query CrmObjectsSearchQuery($filterGroups:[FilterGroup!]!$sorts:[Sort!]$query:String$objectTypeId:String!$properties:[String!]!$count:Int$offset:Int){crmObjectsSearch(filterGroups:$filterGroups sorts:$sorts query:$query type:$objectTypeId count:$count offset:$offset){total offset results{id properties(names:$properties){name value}}}}`,
      variables: {
        filterGroups: [{ filters: [] }],
        objectTypeId: '0-5',
        query: '',
        properties: [
          'subject',
          'content',
          'hs_pipeline',
          'hs_pipeline_stage',
          'hs_ticket_priority',
          'createdate',
          'hubspot_owner_id',
          'hs_object_id',
        ],
        sorts: [
          { property: 'createdate', order: 'DESC' },
          { property: 'hs_object_id', order: 'DESC' },
        ],
        count,
        offset,
      },
    }),
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();
  const searchResult = data.data?.crmObjectsSearch;

  if (!searchResult) {
    throw new ContractDrift('No crmObjectsSearch data in response');
  }

  type TicketSearchItem = {
    id: string;
    properties?: Array<{ name: string; value: string }>;
  };
  const tickets = (searchResult.results || []).map(
    (ticket: TicketSearchItem) => {
      const props: Record<string, string> = {};
      (ticket.properties || []).forEach((p) => {
        props[p.name] = p.value;
      });
      return {
        id: ticket.id,
        ...props,
      };
    },
  );

  return {
    total: searchResult.total,
    offset: searchResult.offset,
    count: tickets.length,
    tickets,
  };
}

export async function getTicket(opts: {
  csrf: string;
  portalId: string;
  ticketId: string;
}): Promise<{
  id: string;
  objectTypeId: string;
  [key: string]: unknown;
}> {
  const url = new URL(
    `${window.location.origin}/api/inbounddb-objects/v1/crm-objects/0-5/${opts.ticketId}`,
  );
  url.searchParams.set('portalId', opts.portalId);
  url.searchParams.set('clienttimeout', '14000');
  url.searchParams.set('hs_static_app', 'crm-records-ui');
  url.searchParams.set('hs_static_app_version', '1.81335');
  url.searchParams.set('allPropertiesFetchMode', 'latest_version');

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
  const props = data.properties || {};
  const ticket: { id: string; objectTypeId: string; [key: string]: unknown } = {
    id: data.objectId || opts.ticketId,
    objectTypeId: data.objectTypeId,
  };

  for (const [key, val] of Object.entries(props)) {
    ticket[key] = (val as { value?: unknown })?.value;
  }

  ticket.allProperties = props;
  return ticket;
}

interface TicketAssociation {
  existingObjectTypeAndId: {
    objectTypeId: string;
    objectId: number;
  };
  associationCategory: string;
  associationTypeId: number;
  associationSpec: {
    associationCategory: string;
    associationTypeId: number;
  };
}

export async function createTicket(
  opts: CreateTicketInput,
): Promise<CreateTicketOutput> {
  const url = new URL(
    `${window.location.origin}/api/chirp-frontend-app/v1/gateway/com.hubspot.crm.object.builder.rpc.ObjectBuilderRpc/createObjectAndAssociations`,
  );
  url.searchParams.set('portalId', opts.portalId);
  url.searchParams.set('clienttimeout', '5000');
  url.searchParams.set('hs_static_app', 'object-builder-ui');
  url.searchParams.set('hs_static_app_version', '1.53263');

  const associations: TicketAssociation[] = [];
  if (opts.contactId) {
    associations.push({
      existingObjectTypeAndId: {
        objectTypeId: '0-1',
        objectId: parseInt(opts.contactId),
      },
      associationCategory: 'HUBSPOT_DEFINED',
      associationTypeId: 16,
      associationSpec: {
        associationCategory: 'HUBSPOT_DEFINED',
        associationTypeId: 16,
      },
    });
  }
  if (opts.companyId) {
    associations.push({
      existingObjectTypeAndId: {
        objectTypeId: '0-2',
        objectId: parseInt(opts.companyId),
      },
      associationCategory: 'HUBSPOT_DEFINED',
      associationTypeId: 26,
      associationSpec: {
        associationCategory: 'HUBSPOT_DEFINED',
        associationTypeId: 26,
      },
    });
  }

  // Build properties from subject + defaults + additional properties
  const propsMap: Record<string, string> = convertDateProps({
    subject: opts.subject,
    hs_pipeline: '0',
    hs_pipeline_stage: '1',
    ...opts.properties,
  });

  const properties: Array<{ name: string; value: string; source: string }> =
    Object.entries(propsMap).map(([name, value]) => ({
      name,
      value: String(value),
      source: 'CRM_UI',
    }));

  const response = await fetch(url.toString(), {
    method: 'POST',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-hubspot-csrf-hubspotapi': opts.csrf,
    },
    body: JSON.stringify({
      createRequest: {
        objectTypeId: '0-5',
        properties,
        associations,
        lineItemFromProductCreateRequests: [],
        propertySource: 'CRM_UI',
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throwForStatus(response.status, text || undefined);
  }

  const data = await response.json();

  const objectId =
    data.data?.result?.crmObject?.objectId ?? data.objectId ?? data.id;

  return {
    objectId: objectId as number,
    _rawResponse: data,
  };
}

export async function updateTicket(opts: {
  csrf: string;
  portalId: string;
  ticketId: string;
  properties: Record<string, string>;
}): Promise<{
  updated: true;
  ticketId: string;
  properties: Record<string, string>;
}> {
  const url = new URL(
    `${window.location.origin}/api/inbounddb-objects/v1/crm-objects/0-5`,
  );
  url.searchParams.set('portalId', opts.portalId);
  url.searchParams.set('clienttimeout', '14000');
  url.searchParams.set('hs_static_app', 'crm-records-ui');
  url.searchParams.set('hs_static_app_version', '1.81335');

  const converted = convertDateProps(opts.properties);
  const propertyValues = Object.entries(converted).map(([name, value]) => ({
    name,
    value,
  }));

  const response = await fetch(url.toString(), {
    method: 'PUT',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-hubspot-csrf-hubspotapi': opts.csrf,
    },
    body: JSON.stringify([
      {
        objectId: opts.ticketId,
        objectTypeId: '0-5',
        propertyValues,
      },
    ]),
  });

  if (!response.ok) {
    const text = await response.text();
    throwForStatus(response.status, text || undefined);
  }

  return {
    updated: true,
    ticketId: opts.ticketId,
    properties: opts.properties,
  };
}

export async function deleteTicket(opts: {
  csrf: string;
  portalId: string;
  ticketId: string;
}): Promise<void> {
  const url = new URL(
    `${window.location.origin}/api/inbounddb-objects/v1/crm-objects/0-5/${opts.ticketId}`,
  );
  url.searchParams.set('portalId', opts.portalId);
  url.searchParams.set('clienttimeout', '14000');

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
}
