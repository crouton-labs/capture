/**
 * HubSpot Workflows Operations
 *
 * Workflows are CRM objects (objectTypeId 0-44). Listing uses GraphQL
 * crmObjectsSearch. Detail uses the automationplatform v1 flows API.
 */

import { ContractDrift, throwForStatus } from '@vallum/_runtime';

export interface Workflow {
  id: string;
  name: string;
  flowId: string;
  enabled: boolean;
  status: string;
  objectTypeId: string;
  sourceApp: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export async function listWorkflows(opts: {
  csrf: string;
  portalId: string;
  limit?: number;
  objectType?: string;
}): Promise<Workflow[]> {
  const count = Math.min(opts.limit ?? 100, 100);

  const filters: Array<Record<string, unknown>> = [
    { operator: 'EQ', property: 'hs_is_external', value: 'false' },
    { operator: 'EQ', property: 'hs_is_deleted', value: 'false' },
  ];

  if (opts.objectType) {
    filters.push({
      operator: 'EQ',
      property: 'hs_object_type_id',
      value: opts.objectType,
    });
  }

  const url = new URL(`${window.location.origin}/api/graphql/crm`);
  url.searchParams.set('portalId', opts.portalId);

  const response = await fetch(url.toString(), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'x-hubspot-csrf-hubspotapi': opts.csrf,
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      operationName: 'ListingLibCrmSearchQuery',
      query: `query ListingLibCrmSearchQuery($count:Int$filterGroups:[FilterGroup!]!$objectTypeId:String!$offset:Int$sorts:[Sort!]){crmObjectsSearch(count:$count filterGroups:$filterGroups offset:$offset sorts:$sorts type:$objectTypeId){total offset hasMore results{id allProperties{name value}}}}`,
      variables: {
        count,
        filterGroups: [{ filters }],
        objectTypeId: '0-44',
        offset: 0,
        sorts: [{ property: 'hs_flow_updated_at', order: 'DESC' }],
      },
    }),
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();

  if (data.errors) {
    throw new ContractDrift(`GraphQL errors: ${JSON.stringify(data.errors)}`);
  }

  const searchResult = data.data?.crmObjectsSearch;
  if (!searchResult) {
    throw new ContractDrift('No crmObjectsSearch data in response');
  }

  type WorkflowSearchItem = {
    id: string;
    allProperties?: Array<{ name: string; value: string }>;
  };
  return searchResult.results.map((r: WorkflowSearchItem) => {
    const props: Record<string, string> = {};
    (r.allProperties || []).forEach((p) => {
      props[p.name] = p.value;
    });
    return {
      id: String(r.id),
      name: props.hs_name || '',
      flowId: props.hs_flow_id || '',
      enabled: props.hs_enabled === 'true',
      status: props.hs_status || '',
      objectTypeId: props.hs_object_type_id || '',
      sourceApp: props.hs_source_app || '',
      createdAt: props.hs_createdate || '',
      updatedAt: props.hs_lastmodifieddate || '',
      ...props,
    };
  });
}

export async function getWorkflow(opts: {
  csrf: string;
  portalId: string;
  flowId: string;
}): Promise<Record<string, unknown>> {
  const url = new URL(
    `${window.location.origin}/api/automationplatform/v1/flows/${opts.flowId}`,
  );
  url.searchParams.set('portalId', opts.portalId);

  const response = await fetch(url.toString(), {
    method: 'GET',
    credentials: 'include',
    headers: {
      'x-hubspot-csrf-hubspotapi': opts.csrf,
      accept: 'application/json',
    },
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  return await response.json();
}
