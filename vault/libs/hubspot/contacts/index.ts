/**
 * HubSpot Contact Operations
 *
 * CRUD operations for HubSpot contacts.
 */

import type {
  ListContactsInput,
  ListContactsOutput,
  GetContactInput,
  GetContactOutput,
  CreateContactInput,
  CreateContactOutput,
  UpdateContactInput,
  UpdateContactOutput,
  DeleteContactInput,
} from '../schemas';
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

export async function listContacts(
  opts: ListContactsInput,
): Promise<ListContactsOutput> {
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
        objectTypeId: '0-1',
        query: '',
        properties: [
          'createdate',
          'email',
          'firstname',
          'lastname',
          'hs_object_id',
          'lifecyclestage',
          'hubspot_owner_id',
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

  const contacts = (searchResult.results || []).map(
    (contact: Record<string, unknown>) => {
      const props: Record<string, string> = {};
      (
        (contact.properties as Array<{ name: string; value: string }>) || []
      ).forEach((p) => {
        props[p.name] = p.value;
      });
      return {
        id: contact.id as string,
        ...props,
      };
    },
  );

  return {
    total: searchResult.total,
    offset: searchResult.offset,
    count: contacts.length,
    contacts,
  };
}

export async function getContact(
  opts: GetContactInput,
): Promise<GetContactOutput> {
  const url = new URL(
    `${window.location.origin}/api/inbounddb-objects/v1/crm-objects/0-1/${opts.contactId}`,
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
  const contact: Record<string, unknown> = {
    id: data.objectId || opts.contactId,
    objectTypeId: data.objectTypeId,
  };

  for (const [key, val] of Object.entries(props)) {
    contact[key] = (val as { value: unknown })?.value;
  }

  contact.allProperties = props;
  return contact as GetContactOutput;
}

export async function createContact(
  opts: CreateContactInput,
): Promise<CreateContactOutput> {
  const url = new URL(
    `${window.location.origin}/api/chirp-frontend-app/v1/gateway/com.hubspot.crm.object.builder.rpc.ObjectBuilderRpc/createObjectAndAssociations`,
  );
  url.searchParams.set('portalId', opts.portalId);
  url.searchParams.set('clienttimeout', '5000');
  url.searchParams.set('hs_static_app', 'object-builder-ui');
  url.searchParams.set('hs_static_app_version', '1.53263');

  // Build properties from email + defaults + additional properties
  const propsMap: Record<string, string> = convertDateProps({
    email: opts.email,
    hs_all_assigned_business_unit_ids: '0',
    hs_pipeline: 'contacts-lifecycle-pipeline',
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
        objectTypeId: '0-1',
        properties,
        associations: [],
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

export async function updateContact(
  opts: UpdateContactInput,
): Promise<UpdateContactOutput> {
  const url = new URL(
    `${window.location.origin}/api/inbounddb-objects/v1/crm-objects/0-1`,
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
        objectId: opts.contactId,
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
    contactId: opts.contactId,
    properties: opts.properties,
  };
}

export async function deleteContact(opts: DeleteContactInput): Promise<void> {
  const url = new URL(
    `${window.location.origin}/api/inbounddb-objects/v1/crm-objects/0-1/${opts.contactId}`,
  );
  url.searchParams.set('portalId', opts.portalId);
  url.searchParams.set('clienttimeout', '14000');
  url.searchParams.set('hs_static_app', 'crm-records-ui');
  url.searchParams.set('hs_static_app_version', '1.81335');

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
