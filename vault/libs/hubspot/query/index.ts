/**
 * HubSpot Flexible CRM Query
 *
 * SQL-like query interface for CRM objects with filtering and sorting.
 */

import type {
  QueryCrmInput,
  QueryCrmOutput,
  GetRecordInput,
  GetRecordOutput,
  CreateRecordInput,
  CreateRecordOutput,
  UpdateRecordInput,
  DeleteRecordInput,
} from '../schemas';
import { ContractDrift, Validation, throwForStatus } from '@vallum/_runtime';

function toEpochMs(val: string): string {
  if (/^\d+$/.test(val)) return val;
  const ms = new Date(val).getTime();
  if (isNaN(ms)) return val;
  return String(ms);
}

const OBJECT_TYPE_IDS: Record<string, string> = {
  contacts: '0-1',
  companies: '0-2',
  deals: '0-3',
  tickets: '0-5',
  products: '0-7',
  'line items': '0-8',
  quotes: '0-14',
  tasks: '0-27',
};

function resolveObjectTypeId(objectType: string): string {
  return OBJECT_TYPE_IDS[objectType.toLowerCase()] || objectType;
}

/**
 * Flexible CRM query with property selection and filtering.
 * Like a SELECT with WHERE clause for HubSpot CRM.
 *
 * @example
 * // Get all company names and lifecycle stages
 * const result = await queryCrm({
 *   csrf, portalId,
 *   objectType: 'companies',
 *   properties: ['name', 'lifecyclestage']
 * });
 *
 * @example
 * // Get contacts where lifecycle stage is 'customer'
 * const result = await queryCrm({
 *   csrf, portalId,
 *   objectType: 'contacts',
 *   properties: ['email', 'firstname', 'lastname'],
 *   filters: [{ property: 'lifecyclestage', operator: 'EQ', value: 'customer' }]
 * });
 *
 * @example
 * // Get deals over $10,000
 * const result = await queryCrm({
 *   csrf, portalId,
 *   objectType: 'deals',
 *   properties: ['dealname', 'amount'],
 *   filters: [{ property: 'amount', operator: 'GTE', value: '10000' }]
 * });
 */
export async function queryCrm(opts: QueryCrmInput): Promise<QueryCrmOutput> {
  const objectTypeId = resolveObjectTypeId(opts.objectType);
  if (!objectTypeId) {
    throw new Validation(`Invalid objectType: ${opts.objectType}`);
  }

  const count = opts.count ?? 100;
  const offset = opts.offset ?? 0;
  const filters = opts.filters ?? [];
  const query = opts.query ?? '';

  // Build filter groups for GraphQL
  // Each filter becomes { property, operator, value/values }
  // Auto-convert date property values to epoch ms
  const graphqlFilters = filters.map((f) => {
    const isDateProp = f.property.includes('date');
    const filter: Record<string, unknown> = {
      property: f.property,
      operator: f.operator,
    };

    if (f.operator === 'IN' || f.operator === 'NOT_IN') {
      const vals =
        f.values ??
        (Array.isArray(f.value) ? f.value : f.value ? [f.value] : []);
      filter.values = isDateProp ? vals.map(toEpochMs) : vals;
    } else if (
      f.operator !== 'HAS_PROPERTY' &&
      f.operator !== 'NOT_HAS_PROPERTY'
    ) {
      const val = Array.isArray(f.value) ? (f.value[0] ?? '') : (f.value ?? '');
      filter.value = isDateProp ? toEpochMs(val) : val;
    }

    return filter;
  });

  // If operator is OR, each filter goes in its own group
  // If operator is AND (default), all filters go in one group
  let filterGroups: Array<{ filters: Array<Record<string, unknown>> }>;

  if (opts.filterGroupsOperator === 'OR' && graphqlFilters.length > 0) {
    // OR: each filter in its own group
    filterGroups = graphqlFilters.map((f) => ({ filters: [f] }));
  } else {
    // AND: all filters in one group
    filterGroups = [{ filters: graphqlFilters }];
  }

  // Default sorts if not provided
  const sorts = opts.sorts ?? [
    { property: 'createdate', order: 'DESC' as const },
    { property: 'hs_object_id', order: 'DESC' as const },
  ];

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
        filterGroups,
        objectTypeId,
        query,
        properties: opts.properties ?? ['hs_object_id'],
        sorts,
        count,
        offset,
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throwForStatus(response.status, text || undefined);
  }

  const data = await response.json();

  if (data.errors) {
    throw new ContractDrift(`GraphQL errors: ${JSON.stringify(data.errors)}`);
  }

  const searchResult = data.data?.crmObjectsSearch;

  if (!searchResult) {
    throw new ContractDrift('No crmObjectsSearch data in response');
  }

  type SearchResultItem = {
    id: string;
    properties?: Array<{ name: string; value: string }>;
  };
  const results = (searchResult.results || []).map((item: SearchResultItem) => {
    const props: Record<string, string> = {};
    (item.properties || []).forEach((p) => {
      props[p.name] = p.value;
    });
    return {
      id: item.id,
      ...props,
    };
  });

  return {
    total: searchResult.total,
    offset: searchResult.offset ?? offset,
    count: results.length,
    results,
  };
}

export async function getRecord(
  opts: GetRecordInput,
): Promise<GetRecordOutput> {
  const objectTypeId = resolveObjectTypeId(opts.objectType);

  const url = new URL(
    `${window.location.origin}/api/inbounddb-objects/v1/crm-objects/${objectTypeId}/${opts.objectId}`,
  );
  url.searchParams.set('portalId', opts.portalId);
  url.searchParams.set('clienttimeout', '14000');
  url.searchParams.set('allPropertiesFetchMode', 'latest_version');

  const response = await fetch(url.toString(), {
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'x-hubspot-csrf-hubspotapi': opts.csrf,
    },
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();
  const props = data.properties || {};
  const record: { [x: string]: unknown; id: string; objectTypeId: string } = {
    id: data.objectId || opts.objectId,
    objectTypeId: data.objectTypeId,
  };

  for (const [key, val] of Object.entries(props)) {
    record[key] = (val as { value?: unknown })?.value;
  }

  return record;
}

export async function createRecord(
  opts: CreateRecordInput,
): Promise<CreateRecordOutput> {
  const objectTypeId = resolveObjectTypeId(opts.objectType);

  const url = new URL(
    `${window.location.origin}/api/chirp-frontend-app/v1/gateway/com.hubspot.crm.object.builder.rpc.ObjectBuilderRpc/createObjectAndAssociations`,
  );
  url.searchParams.set('portalId', opts.portalId);
  url.searchParams.set('clienttimeout', '5000');

  const properties = Object.entries(opts.properties).map(([name, value]) => ({
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
        objectTypeId,
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

  return { objectId: objectId as number };
}

export async function updateRecord(opts: UpdateRecordInput): Promise<void> {
  const objectTypeId = resolveObjectTypeId(opts.objectType);

  const url = new URL(
    `${window.location.origin}/api/inbounddb-objects/v1/crm-objects/${objectTypeId}`,
  );
  url.searchParams.set('portalId', opts.portalId);
  url.searchParams.set('clienttimeout', '14000');

  const propertyValues = Object.entries(opts.properties).map(
    ([name, value]) => ({ name, value }),
  );

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
        objectId: opts.objectId,
        objectTypeId,
        propertyValues,
      },
    ]),
  });

  if (!response.ok) {
    const text = await response.text();
    throwForStatus(response.status, text || undefined);
  }
}

export async function deleteRecord(opts: DeleteRecordInput): Promise<void> {
  const objectTypeId = resolveObjectTypeId(opts.objectType);

  const url = new URL(
    `${window.location.origin}/api/inbounddb-objects/v1/crm-objects/${objectTypeId}/${opts.objectId}`,
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
