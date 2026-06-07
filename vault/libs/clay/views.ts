/**
 * View operations
 */

import { Validation } from '@vallum/_runtime';
import { clayFetch, type TableResponse, type TableViewData } from './shared';
import type {
  ListViewsOutput,
  CreateViewOutput,
  UpdateViewOutput,
  DeleteViewOutput,
  DuplicateViewOutput,
  SetViewFilterInput,
  SetViewFilterOutput,
  SetViewSortInput,
  SetViewSortOutput,
} from './schemas';

export async function listViews(opts: {
  tableId: string;
}): Promise<ListViewsOutput> {
  const { tableId } = opts;
  if (!tableId) throw new Validation('tableId is required');

  const data = await clayFetch<TableResponse>(`/tables/${tableId}`);
  const views = data.table.views ?? [];

  return {
    views,
    totalCount: views.length,
  };
}

/**
 * Bulk fetch records from a table by record IDs.
 */

export async function createView(opts: {
  tableId: string;
  name: string;
}): Promise<CreateViewOutput> {
  const { tableId, name } = opts;

  if (!tableId) {
    throw new Validation('tableId is required');
  }
  if (!name) {
    throw new Validation('name is required');
  }

  const data = await clayFetch<TableViewData>(`/tables/${tableId}/views`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });

  return data;
}

/**
 * Update view settings (name, description, limit, offset).
 * Filter and sort use separate endpoints; see setViewFilter and setViewSort.
 */

export async function updateView(opts: {
  tableId: string;
  viewId: string;
  name?: string;
  description?: string | null;
  limit?: number | null;
  offset?: number | null;
}): Promise<UpdateViewOutput> {
  const { tableId, viewId, name, description, limit, offset } = opts;

  if (!tableId) {
    throw new Validation('tableId is required');
  }
  if (!viewId) {
    throw new Validation('viewId is required');
  }

  const body: Record<string, unknown> = {};
  if (name !== undefined) body.name = name;
  if (description !== undefined) body.description = description;
  if (limit !== undefined) body.limit = limit;
  if (offset !== undefined) body.offset = offset;

  if (Object.keys(body).length === 0) {
    throw new Validation(
      'At least one field to update is required (name, description, limit, or offset)',
    );
  }

  const data = await clayFetch<TableViewData>(
    `/tables/${tableId}/views/${viewId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(body),
    },
  );

  return data;
}

/**
 * Delete a view from a table.
 * After deletion, navigates the browser to the table's default view
 * to avoid leaving the user on a 404 page.
 */

export async function deleteView(opts: {
  tableId: string;
  viewId: string;
}): Promise<DeleteViewOutput> {
  const { tableId, viewId } = opts;

  if (!tableId) {
    throw new Validation('tableId is required');
  }
  if (!viewId) {
    throw new Validation('viewId is required');
  }

  // Fetch table metadata to get workbookId for post-deletion navigation
  const tableData = await clayFetch<TableResponse>(`/tables/${tableId}`);
  const workbookId = tableData.table.workbookId;
  const workspaceId = tableData.table.workspaceId;

  await clayFetch(`/tables/${tableId}/views/${viewId}`, {
    method: 'DELETE',
  });

  // Navigate to the table's default view to avoid 404 on deleted view URL
  if (workbookId && workspaceId) {
    const origin = window.location.origin;
    window.location.href = `${origin}/workspaces/${workspaceId}/workbooks/${workbookId}`;
  }

  return {
    success: true,
  };
}

export async function duplicateView(opts: {
  tableId: string;
  viewId: string;
  name: string;
}): Promise<DuplicateViewOutput> {
  const { tableId, viewId, name } = opts;

  if (!tableId) {
    throw new Validation('duplicateView: tableId is required');
  }
  if (!viewId) {
    throw new Validation('duplicateView: viewId is required');
  }
  if (!name) {
    throw new Validation('duplicateView: name is required');
  }

  const data = await clayFetch<TableViewData>(
    `/tables/${tableId}/views/${viewId}/duplicate`,
    { method: 'POST' },
  );

  // The API always names the copy "Copy of {original}".
  // If the caller wants a different name, rename via PATCH.
  if (data.name !== name) {
    const renamed = await clayFetch<TableViewData>(
      `/tables/${tableId}/views/${data.id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      },
    );
    return renamed as DuplicateViewOutput;
  }

  return data as DuplicateViewOutput;
}

/**
 * Set or clear filter on a view.
 */

export async function setViewFilter(
  opts: SetViewFilterInput,
): Promise<SetViewFilterOutput> {
  const { tableId, viewId, filter } = opts;

  if (!tableId) throw new Validation('tableId is required');
  if (!viewId) throw new Validation('viewId is required');

  // Send filter object to set, or empty object to clear
  const body = filter && filter.items && filter.items.length > 0 ? filter : {};

  const data = await clayFetch<TableViewData>(
    `/tables/${tableId}/views/${viewId}/filter`,
    { method: 'PATCH', body: JSON.stringify(body) },
  );

  return data;
}

/**
 * Set or clear sort on a view.
 */

export async function setViewSort(
  opts: SetViewSortInput,
): Promise<SetViewSortOutput> {
  const { tableId, viewId, sort } = opts;

  if (!tableId) throw new Validation('tableId is required');
  if (!viewId) throw new Validation('viewId is required');

  // Send sort object to set, or {items:[]} to clear
  const body =
    sort && sort.items && sort.items.length > 0 ? sort : { items: [] };

  const data = await clayFetch<TableViewData>(
    `/tables/${tableId}/views/${viewId}/sort`,
    { method: 'PATCH', body: JSON.stringify(body) },
  );

  return data;
}

// ============================================================================
// Table Operations
// ============================================================================

/**
 * Duplicate a table.
 */
