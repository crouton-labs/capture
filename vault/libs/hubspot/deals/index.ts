/**
 * HubSpot Deal Operations
 *
 * CRUD operations for HubSpot deals.
 */

import type {
  ListDealsInput,
  ListDealsOutput,
  GetDealInput,
  GetDealOutput,
  CreateDealInput,
  CreateDealOutput,
  UpdateDealInput,
  UpdateDealOutput,
  DeleteDealInput,
} from '../schemas';
import { ContractDrift, throwForStatus } from '@vallum/_runtime';

const DATE_PROPS = new Set([
  'closedate',
  'createdate',
  'lastmodifieddate',
  'hs_date_entered_',
  'hs_date_exited_',
]);

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
    out[k] = DATE_PROPS.has(k) || k.includes('date') ? toEpochMs(v) : v;
  }
  return out;
}

export async function listDeals(
  opts: ListDealsInput,
): Promise<ListDealsOutput> {
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
        objectTypeId: '0-3',
        query: '',
        properties: [
          'dealname',
          'amount',
          'dealstage',
          'pipeline',
          'closedate',
          'createdate',
          'hubspot_owner_id',
        ],
        sorts: [{ property: 'createdate', order: 'DESC' }],
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

  const deals = (searchResult.results || []).map(
    (deal: Record<string, unknown>) => {
      const props: Record<string, string> = {};
      (
        (deal.properties as Array<{ name: string; value: string }>) || []
      ).forEach((p) => {
        props[p.name] = p.value;
      });
      return { id: deal.id as string, ...props };
    },
  );

  return {
    total: searchResult.total,
    offset: searchResult.offset,
    count: deals.length,
    deals,
  };
}

export async function getDeal(opts: GetDealInput): Promise<GetDealOutput> {
  const url = new URL(
    `${window.location.origin}/api/inbounddb-objects/v1/crm-objects/0-3/${opts.dealId}`,
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

  const deal: Record<string, unknown> = {
    id: data.objectId || opts.dealId,
    objectTypeId: data.objectTypeId,
  };

  for (const [key, val] of Object.entries(props)) {
    deal[key] = (val as { value: unknown })?.value;
  }

  deal.allProperties = props;
  return deal as GetDealOutput;
}

interface DealAssociation {
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

export async function createDeal(
  opts: CreateDealInput,
): Promise<CreateDealOutput> {
  const url = new URL(
    `${window.location.origin}/api/chirp-frontend-app/v1/gateway/com.hubspot.crm.object.builder.rpc.ObjectBuilderRpc/createObjectAndAssociations`,
  );
  url.searchParams.set('portalId', opts.portalId);
  url.searchParams.set('clienttimeout', '5000');
  url.searchParams.set('hs_static_app', 'object-builder-ui');
  url.searchParams.set('hs_static_app_version', '1.53263');

  const associations: DealAssociation[] = [];
  if (opts.contactId) {
    associations.push({
      existingObjectTypeAndId: {
        objectTypeId: '0-1',
        objectId: parseInt(opts.contactId),
      },
      associationCategory: 'HUBSPOT_DEFINED',
      associationTypeId: 3,
      associationSpec: {
        associationCategory: 'HUBSPOT_DEFINED',
        associationTypeId: 3,
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
      associationTypeId: 5,
      associationSpec: {
        associationCategory: 'HUBSPOT_DEFINED',
        associationTypeId: 5,
      },
    });
  }

  // Build properties from dealname + defaults + additional properties
  const propsMap: Record<string, string> = convertDateProps({
    dealname: opts.dealname,
    dealstage: 'appointmentscheduled',
    pipeline: 'default',
    ...opts.properties,
  });

  const properties: Array<{ name: string; value: string; source: string }> =
    Object.entries(propsMap).map(([name, value]) => ({
      name,
      value,
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
        objectTypeId: '0-3',
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

export async function updateDeal(
  opts: UpdateDealInput,
): Promise<UpdateDealOutput> {
  const url = new URL(
    `${window.location.origin}/api/inbounddb-objects/v1/crm-objects/0-3`,
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
        objectId: opts.dealId,
        objectTypeId: '0-3',
        propertyValues,
      },
    ]),
  });

  if (!response.ok) {
    const text = await response.text();
    throwForStatus(response.status, text || undefined);
  }

  return { updated: true, dealId: opts.dealId, properties: opts.properties };
}

export async function deleteDeal(opts: DeleteDealInput): Promise<void> {
  const url = new URL(
    `${window.location.origin}/api/inbounddb-objects/v1/crm-objects/0-3/${opts.dealId}`,
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
