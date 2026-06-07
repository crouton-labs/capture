/**
 * HubSpot CRM Views Operations
 *
 * Create, list, get, update, and delete saved views for CRM object types.
 * Views define columns, filters, and sort order for object list pages.
 */

import type {
  ListViewsInput,
  ListViewsOutput,
  GetViewInput,
  GetViewOutput,
  CreateViewInput,
  CreateViewOutput,
  UpdateViewInput,
  UpdateViewOutput,
  DeleteViewInput,
} from '../schemas';
import { throwForStatus } from '@vallum/_runtime';

function toViewObject(v: Record<string, unknown>) {
  return {
    id: v.id as number,
    name: v.name as string,
    objectTypeId: v.objectTypeId as string,
    type: (v.type as string) || 'STANDARD',
    private: v.private as boolean,
    columns: v.columns as string,
    filterGroups: v.filterGroups as string,
    quickFilters: v.quickFilters as string,
    viewColor: (v.viewColor as string) || undefined,
    ownerId: v.ownerId as number | undefined,
    createdBy: v.createdBy as number | undefined,
    createdTimestamp: v.createdTimestamp as number | undefined,
    lastModifiedTimestamp: v.lastModifiedTimestamp as number | undefined,
  };
}

export async function listViews(
  opts: ListViewsInput,
): Promise<ListViewsOutput> {
  const objectTypeId = opts.objectTypeId ?? '0-1';

  const url = new URL(
    `${window.location.origin}/api/sales/v4/views/${objectTypeId}/pinned/view`,
  );
  url.searchParams.set('namespace', 'NONE');
  url.searchParams.set('count', '50');
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

  return {
    views: (data.results || []).map(toViewObject),
    total: data.total ?? 0,
    hasMore: data.hasMore ?? false,
  };
}

export async function getView(opts: GetViewInput): Promise<GetViewOutput> {
  const objectTypeId = opts.objectTypeId ?? '0-1';

  const url = new URL(
    `${window.location.origin}/api/sales/v4/views/${objectTypeId}/${opts.viewId}`,
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
  return toViewObject(data);
}

export async function createView(
  opts: CreateViewInput,
): Promise<CreateViewOutput> {
  const objectTypeId = opts.objectTypeId ?? '0-1';

  const columns =
    opts.columns ??
    JSON.stringify([
      { name: 'email' },
      { name: 'phone' },
      { name: 'hubspot_owner_id' },
    ]);

  const body: Record<string, unknown> = {
    name: opts.name,
    objectTypeId,
    private: opts.private ?? false,
    columns,
    filterGroups: opts.filterGroups ?? JSON.stringify([]),
    quickFilters: opts.quickFilters ?? JSON.stringify([]),
    namespace: 0,
  };
  if (opts.viewColor) {
    body.viewColor = opts.viewColor;
  }

  const url = new URL(`${window.location.origin}/api/sales/v4/views`);
  url.searchParams.set('portalId', opts.portalId);

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
  return toViewObject(data);
}

export async function updateView(
  opts: UpdateViewInput,
): Promise<UpdateViewOutput> {
  const objectTypeId = opts.objectTypeId ?? '0-1';

  // Fetch current view (PUT requires full object)
  const getUrl = new URL(
    `${window.location.origin}/api/sales/v4/views/${objectTypeId}/${opts.viewId}`,
  );
  getUrl.searchParams.set('portalId', opts.portalId);

  const getResp = await fetch(getUrl.toString(), {
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'x-hubspot-csrf-hubspotapi': opts.csrf,
    },
  });

  if (!getResp.ok) {
    throwForStatus(getResp.status, await getResp.text().catch(() => undefined));
  }

  const current = await getResp.json();

  // Merge updates
  const body: Record<string, unknown> = { ...current };
  delete body.currentViewVisualization;
  delete body.visualizationSettingsString;

  if (opts.name !== undefined) body.name = opts.name;
  if (opts.columns !== undefined) body.columns = opts.columns;
  if (opts.filterGroups !== undefined) body.filterGroups = opts.filterGroups;
  if (opts.quickFilters !== undefined) body.quickFilters = opts.quickFilters;
  if (opts.private !== undefined) body.private = opts.private;
  if (opts.viewColor !== undefined) body.viewColor = opts.viewColor;

  const putUrl = new URL(
    `${window.location.origin}/api/sales/v4/views/${opts.viewId}`,
  );
  putUrl.searchParams.set('portalId', opts.portalId);

  const response = await fetch(putUrl.toString(), {
    method: 'PUT',
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
  return toViewObject(data);
}

export async function deleteView(
  opts: DeleteViewInput,
): Promise<{ deleted: true }> {
  const url = new URL(
    `${window.location.origin}/api/sales/v4/views/${opts.viewId}`,
  );
  url.searchParams.set('portalId', opts.portalId);

  const response = await fetch(url.toString(), {
    method: 'DELETE',
    credentials: 'include',
    headers: {
      'x-hubspot-csrf-hubspotapi': opts.csrf,
    },
  });

  if (response.status !== 204 && !response.ok) {
    const text = await response.text();
    throwForStatus(response.status, text || undefined);
  }

  return { deleted: true };
}
