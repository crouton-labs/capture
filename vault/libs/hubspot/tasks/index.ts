/**
 * HubSpot CRM Tasks Operations
 *
 * List via GraphQL (objectTypeId 0-27), create via engagement API,
 * update/delete via inbounddb CRM objects API.
 */

export interface CrmTask {
  id: string;
  hs_task_subject?: string;
  hs_task_body?: string;
  hs_task_status?: string;
  hs_task_priority?: string;
  hs_task_type?: string;
  hubspot_owner_id?: string;
  hs_timestamp?: string;
  createdate?: string;
}

interface CrmProperty {
  name: string;
  value: string;
}

interface CrmObject {
  id: string;
  properties: CrmProperty[];
}

interface CrmSearchResult {
  total: number;
  offset: number;
  results: CrmObject[];
}

interface GraphQLResponse {
  data: {
    crmObjectsSearch: CrmSearchResult;
  };
}

interface Filter {
  property: string;
  operator: string;
  value: string;
}

interface FilterGroup {
  filters: Filter[];
}

interface TaskAssociations {
  contactIds?: number[];
  companyIds?: number[];
  dealIds?: number[];
}

interface TaskMetadata {
  subject: string;
  body: string;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'DEFERRED';
  taskType: string;
  priority?: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';
  dueDate?: string;
  ownerId?: string;
}

import { ContractDrift, Validation, throwForStatus } from '@vallum/_runtime';

function toEpochMs(val: string): string {
  if (/^\d+$/.test(val)) return val;
  const ms = new Date(val).getTime();
  if (isNaN(ms)) return val;
  return String(ms);
}

export async function listTasks(opts: {
  csrf: string;
  portalId: string;
  count?: number;
  offset?: number;
  status?: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'DEFERRED';
}): Promise<{
  total: number;
  offset: number;
  count: number;
  tasks: CrmTask[];
}> {
  const count = opts.count ?? 25;
  const offset = opts.offset ?? 0;

  const url = new URL(`${window.location.origin}/api/graphql/crm`);
  url.searchParams.set('hs_static_app', 'crm-index-ui');
  url.searchParams.set('hs_static_app_version', '2.50992');
  url.searchParams.set('portalId', opts.portalId);

  const filterGroups: FilterGroup[] = [];
  if (opts.status) {
    filterGroups.push({
      filters: [
        {
          property: 'hs_task_status',
          operator: 'EQ',
          value: opts.status,
        },
      ],
    });
  } else {
    filterGroups.push({ filters: [] });
  }

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
        objectTypeId: '0-27',
        query: '',
        properties: [
          'hs_task_subject',
          'hs_task_body',
          'hs_task_status',
          'hs_task_priority',
          'hs_task_type',
          'hubspot_owner_id',
          'hs_timestamp',
          'createdate',
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

  const data = (await response.json()) as GraphQLResponse;
  const searchResult = data.data?.crmObjectsSearch;

  if (!searchResult) {
    throw new ContractDrift('No crmObjectsSearch data in response');
  }

  const tasks = (searchResult.results || []).map((task: CrmObject) => {
    const props: Record<string, string> = { id: task.id };
    (task.properties || []).forEach((p: CrmProperty) => {
      props[p.name] = p.value;
    });
    return props as unknown as CrmTask;
  });

  return {
    total: searchResult.total,
    offset: searchResult.offset,
    count: tasks.length,
    tasks,
  };
}

export async function createTask(opts: {
  csrf: string;
  portalId: string;
  subject: string;
  body?: string;
  ownerId?: string;
  dueDate?: string;
  priority?: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';
  objectType?: 'CONTACT' | 'COMPANY' | 'DEAL';
  objectId?: string;
}): Promise<{ taskId: number }> {
  const url = `${window.location.origin}/api/engagements/v1/engagements?portalId=${opts.portalId}`;

  const associations: TaskAssociations = {};
  if (opts.objectType && opts.objectId) {
    if (opts.objectType === 'CONTACT')
      associations.contactIds = [Number(opts.objectId)];
    else if (opts.objectType === 'COMPANY')
      associations.companyIds = [Number(opts.objectId)];
    else if (opts.objectType === 'DEAL')
      associations.dealIds = [Number(opts.objectId)];
  }

  const metadata: TaskMetadata = {
    subject: opts.subject,
    body: opts.body ? opts.body : '',
    status: 'NOT_STARTED',
    taskType: 'TODO',
  };

  if (opts.priority) {
    metadata.priority = opts.priority;
  }

  if (opts.dueDate) {
    metadata.dueDate = opts.dueDate;
  }

  if (opts.ownerId) {
    metadata.ownerId = opts.ownerId;
  }

  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      'x-hubspot-csrf-hubspotapi': opts.csrf,
    },
    body: JSON.stringify({
      engagement: { type: 'TASK', timestamp: Date.now() },
      associations,
      metadata,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throwForStatus(response.status, text || undefined);
  }

  const data = (await response.json()) as { engagement: { id: number } };
  return { taskId: data.engagement.id };
}

export async function updateTask(opts: {
  csrf: string;
  portalId: string;
  taskId: string;
  subject?: string;
  body?: string;
  status?: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'DEFERRED';
  priority?: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';
  dueDate?: string;
  ownerId?: string;
}): Promise<void> {
  const url = new URL(
    `${window.location.origin}/api/inbounddb-objects/v1/crm-objects/0-27`,
  );
  url.searchParams.set('portalId', opts.portalId);
  url.searchParams.set('clienttimeout', '14000');
  url.searchParams.set('hs_static_app', 'crm-records-ui');
  url.searchParams.set('hs_static_app_version', '1.81335');

  const propMap: Record<string, string> = {
    subject: 'hs_task_subject',
    body: 'hs_task_body',
    status: 'hs_task_status',
    priority: 'hs_task_priority',
    ownerId: 'hubspot_owner_id',
    dueDate: 'hs_timestamp',
  };

  const propertyValues: { name: string; value: string }[] = [];
  for (const [key, prop] of Object.entries(propMap)) {
    const val = opts[key as keyof typeof opts];
    if (val !== undefined) {
      propertyValues.push({
        name: prop,
        value:
          key === 'dueDate' ? String(toEpochMs(val as string)) : String(val),
      });
    }
  }

  if (propertyValues.length === 0) {
    throw new Validation('No properties to update');
  }

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
        objectId: opts.taskId,
        objectTypeId: '0-27',
        propertyValues,
      },
    ]),
  });

  if (!response.ok) {
    const text = await response.text();
    throwForStatus(response.status, text || undefined);
  }
}

export async function deleteTask(opts: {
  csrf: string;
  portalId: string;
  taskId: string;
}): Promise<void> {
  const url = new URL(
    `${window.location.origin}/api/inbounddb-objects/v1/crm-objects/0-27/${opts.taskId}`,
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
