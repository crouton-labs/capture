/**
 * HubSpot Company Operations
 *
 * CRUD and search operations for HubSpot companies.
 */

import type {
  ListCompaniesInput,
  ListCompaniesOutput,
  GetCompanyInput,
  GetCompanyOutput,
  CreateCompanyInput,
  CreateCompanyOutput,
  UpdateCompanyInput,
  UpdateCompanyOutput,
  DeleteCompanyInput,
  DeleteCompanyOutput,
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

export async function listCompanies(
  opts: ListCompaniesInput,
): Promise<ListCompaniesOutput> {
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
      query:
        'query CrmObjectsSearchQuery($filterGroups:[FilterGroup!]!$sorts:[Sort!]$query:String$objectTypeId:String!$properties:[String!]!$count:Int$offset:Int){crmObjectsSearch(filterGroups:$filterGroups sorts:$sorts query:$query type:$objectTypeId count:$count offset:$offset){total results{id properties(names:$properties){name value}}}}',
      variables: {
        filterGroups: [{ filters: [] }],
        objectTypeId: '0-2',
        query: '',
        properties: [
          'name',
          'domain',
          'industry',
          'lifecyclestage',
          'city',
          'state',
          'country',
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
    throw new ContractDrift('No data in response');
  }

  const companies = (searchResult.results || []).map(
    (company: Record<string, unknown>) => {
      const props: Record<string, string> = {};
      (
        (company.properties as Array<{ name: string; value: string }>) || []
      ).forEach((p) => {
        props[p.name] = p.value;
      });
      return { id: company.id as string, ...props };
    },
  );

  return {
    total: searchResult.total,
    count: companies.length,
    companies,
  };
}

export async function getCompany(
  opts: GetCompanyInput,
): Promise<GetCompanyOutput> {
  const url = new URL(
    `${window.location.origin}/api/inbounddb-objects/v1/crm-objects/0-2/${opts.companyId}`,
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

  const company: Record<string, unknown> = {
    id: data.objectId || opts.companyId,
    objectTypeId: data.objectTypeId,
  };

  for (const [key, val] of Object.entries(props)) {
    company[key] = (val as { value: unknown })?.value;
  }

  company.allProperties = props;
  return company as GetCompanyOutput;
}

export async function createCompany(
  opts: CreateCompanyInput,
): Promise<CreateCompanyOutput> {
  const url = new URL(
    `${window.location.origin}/api/chirp-frontend-app/v1/gateway/com.hubspot.crm.object.builder.rpc.ObjectBuilderRpc/createObjectAndAssociations`,
  );
  url.searchParams.set('portalId', opts.portalId);
  url.searchParams.set('clienttimeout', '5000');
  url.searchParams.set('hs_static_app', 'object-builder-ui');
  url.searchParams.set('hs_static_app_version', '1.53263');

  // Build properties from name + additional properties
  const propsMap: Record<string, string> = convertDateProps({
    name: opts.name,
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
        objectTypeId: '0-2',
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

export async function updateCompany(
  opts: UpdateCompanyInput,
): Promise<UpdateCompanyOutput> {
  const url = new URL(
    `${window.location.origin}/api/inbounddb-objects/v1/crm-objects/0-2`,
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
        objectId: opts.companyId,
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
    companyId: opts.companyId,
    properties: opts.properties,
  };
}

export async function deleteCompany(
  opts: DeleteCompanyInput,
): Promise<DeleteCompanyOutput> {
  const url = new URL(
    `${window.location.origin}/api/inbounddb-objects/v1/crm-objects/0-2/${opts.companyId}`,
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

  return {
    deleted: response.status === 204 || response.ok,
    status: response.status,
  };
}
