/**
 * Folder and resource operations
 */

import { Validation, ContractDrift } from '@vallum/_runtime';
import { clayFetch } from './shared';
import type {
  CreateFolderOutput,
  DeleteFolderOutput,
  RenameFolderOutput,
  ListFoldersOutput,
  MoveToFolderOutput,
  SearchResourcesOutput,
  ListTrashOutput,
  RestoreResourceOutput,
  PermanentDeleteTrashItemOutput,
  BulkPermanentDeleteTrashInput,
  BulkPermanentDeleteTrashOutput,
} from './schemas';

/**
 * Create a folder in workspace.
 */
export async function createFolder(opts: {
  workspaceId: string;
  name: string;
  parentFolderId?: string;
}): Promise<CreateFolderOutput> {
  const { workspaceId, name, parentFolderId } = opts;

  if (!workspaceId) {
    throw new Validation('workspaceId is required');
  }
  if (!name) {
    throw new Validation('name is required');
  }

  const body: Record<string, unknown> = { name };
  if (parentFolderId) {
    body.parentFolderId = parentFolderId;
  }

  const data = await clayFetch<CreateFolderOutput>(
    `/workspaces/${workspaceId}/folders`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  );

  return {
    id: data.id,
    workspaceId: data.workspaceId,
    name: data.name,
    icon: data.icon,
    description: data.description,
    createdByUserId: data.createdByUserId,
    parentFolderId: data.parentFolderId,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    deletedAt: data.deletedAt,
    abilities: data.abilities,
    tags: data.tags,
  };
}

/**
 * Delete workspace resources (folders, tables, workbooks) in a single call.
 */
export async function deleteFolder(opts: {
  workspaceId: string;
  folderIds?: string[];
  tableIds?: string[];
  workbookIds?: string[];
  isPermanentDelete?: boolean;
}): Promise<DeleteFolderOutput> {
  const {
    workspaceId,
    folderIds = [],
    tableIds = [],
    workbookIds = [],
    isPermanentDelete = false,
  } = opts;

  if (!workspaceId) {
    throw new Validation('workspaceId is required');
  }
  if (
    folderIds.length === 0 &&
    tableIds.length === 0 &&
    workbookIds.length === 0
  ) {
    throw new Validation(
      'At least one of folderIds, tableIds, or workbookIds must be non-empty',
    );
  }

  await clayFetch(`/workspaces/${workspaceId}/resources/`, {
    method: 'DELETE',
    body: JSON.stringify({
      tableIds,
      workbookIds,
      folderIds,
      isPermanentDelete,
    }),
  });

  return {
    success: true,
  };
}

/**
 * Rename a table.
 */

/**
 * Rename a folder.
 */
export async function renameFolder(opts: {
  folderId: string;
  name: string;
}): Promise<RenameFolderOutput> {
  const { folderId, name } = opts;
  if (!folderId) throw new Validation('folderId is required');
  if (!name) throw new Validation('name is required');

  const data = await clayFetch<RenameFolderOutput>(`/folders/${folderId}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });

  return {
    id: data.id,
    workspaceId: data.workspaceId,
    name: data.name,
    icon: data.icon,
    description: data.description,
    createdByUserId: data.createdByUserId,
    parentFolderId: data.parentFolderId,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    deletedAt: data.deletedAt,
    abilities: data.abilities,
    tags: data.tags,
  };
}

/**
 * List folders in a workspace, optionally scoped to a parent folder.
 */
export async function listFolders(opts: {
  workspaceId: string;
  parentFolderId?: string;
}): Promise<ListFoldersOutput> {
  const { workspaceId, parentFolderId } = opts;

  if (!workspaceId) {
    throw new Validation('workspaceId is required');
  }

  const body: Record<string, unknown> = {
    filters: { resourceTypes: ['FOLDER'] },
  };
  if (parentFolderId) {
    body.parentResource = { id: parentFolderId, type: 'FOLDER' };
  }

  const data = await clayFetch<{
    resources: Array<{
      id: string;
      workspaceId: number;
      name: string;
      icon: { emoji?: string; url?: string } | null;
      description: string | null;
      createdByUserId: string;
      parentFolderId: string | null;
      createdAt: string;
      updatedAt: string;
      deletedAt: string | null;
      abilities: { canDelete?: boolean; canUpdate?: boolean };
      tags: string[];
    }>;
  }>(`/workspaces/${workspaceId}/resources_v2/`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  const folders = (data.resources ?? []).map((r) => ({
    id: r.id,
    workspaceId: r.workspaceId,
    name: r.name,
    icon: r.icon,
    description: r.description,
    createdByUserId: r.createdByUserId,
    parentFolderId: r.parentFolderId,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    deletedAt: r.deletedAt,
    abilities: r.abilities,
    tags: r.tags,
  }));

  return {
    folders,
    totalCount: folders.length,
  };
}

/**
 * Move workbooks to a folder.
 */
export async function moveToFolder(opts: {
  workspaceId: string;
  workbookIds: string[];
  folderId: string | null;
}): Promise<MoveToFolderOutput> {
  const { workspaceId, workbookIds, folderId } = opts;

  if (!workspaceId) {
    throw new Validation('workspaceId is required');
  }
  if (!workbookIds || workbookIds.length === 0) {
    throw new Validation('workbookIds is required');
  }

  const data = await clayFetch<{
    resources: Array<{
      id: string;
      name: string;
      parentFolderId: string | null;
    }>;
    newParentFolder: {
      id: string | null;
      name: string | null;
    };
  }>(`/workspaces/${workspaceId}/resources/move/`, {
    method: 'POST',
    body: JSON.stringify({
      workbookIds,
      parentFolderId: folderId,
    }),
  });

  return {
    resources: (data.resources ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      parentFolderId: r.parentFolderId,
    })),
    newParentFolder: data.newParentFolder,
  };
}

// ============================================================================
// Resource Search
// ============================================================================

interface ResourceSearchResponse {
  resources: Array<{
    id: string;
    workspaceId: number;
    name: string;
    resourceType: string;
    createdAt: string;
    updatedAt: string;
  }>;
  totalCount?: number;
}

/**
 * Search workspace resources by name.
 */

/**
 * Search workspace resources by name.
 */
export async function searchResources(opts: {
  workspaceId: string;
  query: string;
}): Promise<SearchResourcesOutput> {
  const { workspaceId, query } = opts;

  if (!workspaceId) {
    throw new Validation('workspaceId is required');
  }
  if (!query) {
    throw new Validation('query is required');
  }

  const data = await clayFetch<ResourceSearchResponse>(
    `/workspaces/${workspaceId}/resources_v2/`,
    {
      method: 'POST',
      body: JSON.stringify({
        parentResource: null,
        filters: { q: query },
      }),
    },
  );

  // Clay's server-side search is very fuzzy (tokenizes query, matches partial subwords).
  // Apply client-side case-insensitive filtering to return only resources whose name
  // actually contains the query string.
  const lowerQuery = query.toLowerCase();
  const resources = (data.resources || [])
    .filter((r) => r.name.toLowerCase().includes(lowerQuery))
    .map((r) => ({
      id: r.id,
      name: r.name,
      resourceType: r.resourceType,
    }));

  return {
    resources,
    totalCount: resources.length,
  };
}

// ============================================================================
// Data Sources
// ============================================================================

/**
 * List data sources on a table.
 * Reads sourceIds from table typeSettings, then fetches each source individually.
 */

/**
 * List deleted/trashed resources that can be restored.
 */
export async function listTrash(opts: {
  workspaceId: string;
}): Promise<ListTrashOutput> {
  const { workspaceId } = opts;

  if (!workspaceId) throw new Validation('workspaceId is required');

  const data = await clayFetch<{
    resources: Array<{
      resourceType: string;
      id: string;
      name: string;
      description: string | null;
      ownerId: string;
      owner: {
        id: number;
        username: string;
        name: string;
        fullName?: string;
        email: string;
        profilePicture?: string | null;
      };
      parentFolderId: string | null;
      workbookId?: string;
      deletedAt: string;
      createdAt: string;
      updatedAt: string;
    }>;
  }>(`/workspaces/${workspaceId}/deleted-resources/`);

  return {
    resources: (data.resources || []).map((r) => ({
      id: r.id,
      name: r.name,
      resourceType: r.resourceType as 'WORKBOOK' | 'TABLE',
      description: r.description,
      ownerId: r.ownerId,
      owner: r.owner,
      parentFolderId: r.parentFolderId,
      ...(r.workbookId ? { workbookId: r.workbookId } : {}),
      deletedAt: r.deletedAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
  };
}

/**
 * Restore a deleted resource from the trash.
 */

/**
 * Restore a deleted resource from the trash.
 */
export async function restoreResource(opts: {
  workspaceId: string;
  tableIds?: string[];
  workbookIds?: string[];
  folderIds?: string[];
}): Promise<RestoreResourceOutput> {
  const { workspaceId, tableIds, workbookIds, folderIds } = opts;

  if (!workspaceId) throw new Validation('workspaceId is required');
  if (!tableIds?.length && !workbookIds?.length && !folderIds?.length) {
    throw new Validation(
      'At least one of tableIds, workbookIds, or folderIds is required',
    );
  }

  const data = await clayFetch<{
    resources: Array<{
      resourceType: string;
      id: string;
      workspaceId: number;
      name: string;
      description: string | null;
      parentFolderId: string | null;
      workbookId?: string;
      ownerId: string;
      defaultAccess?: string;
      isHiddenFromNavigation?: boolean;
      abilities?: {
        canUpdate?: boolean;
        canDelete?: boolean;
        canManageAccess?: boolean;
        canUpdateFromSandbox?: boolean;
      };
      tags?: string[];
      createdAt: string;
      updatedAt: string;
      deletedAt: string | null;
    }>;
  }>(`/workspaces/${workspaceId}/deleted-resources/restore/`, {
    method: 'POST',
    body: JSON.stringify({
      ...(tableIds?.length ? { tableIds } : {}),
      ...(workbookIds?.length ? { workbookIds } : {}),
      ...(folderIds?.length ? { folderIds } : {}),
    }),
  });

  return {
    resources: (data.resources || []).map((r) => ({
      resourceType: r.resourceType as 'WORKBOOK' | 'TABLE' | 'FOLDER',
      id: r.id,
      workspaceId: r.workspaceId,
      name: r.name,
      description: r.description,
      parentFolderId: r.parentFolderId,
      ...(r.workbookId ? { workbookId: r.workbookId } : {}),
      ownerId: r.ownerId,
      ...(r.defaultAccess !== undefined
        ? { defaultAccess: r.defaultAccess }
        : {}),
      ...(r.isHiddenFromNavigation !== undefined
        ? { isHiddenFromNavigation: r.isHiddenFromNavigation }
        : {}),
      ...(r.abilities ? { abilities: r.abilities } : {}),
      ...(r.tags ? { tags: r.tags } : {}),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      deletedAt: r.deletedAt,
    })),
  };
}

/**
 * Permanently delete a single item from trash.
 */
export async function permanentDeleteTrashItem(opts: {
  workspaceId: string;
  resourceId: string;
}): Promise<PermanentDeleteTrashItemOutput> {
  const { workspaceId, resourceId } = opts;

  if (!workspaceId)
    throw new Validation('permanentDeleteTrashItem: workspaceId is required');
  if (!resourceId)
    throw new Validation('permanentDeleteTrashItem: resourceId is required');

  const body: Record<string, unknown> = { isPermanentDelete: true };
  if (resourceId.startsWith('t_')) {
    body.tableIds = [resourceId];
  } else if (resourceId.startsWith('wb_')) {
    body.workbookIds = [resourceId];
  } else if (resourceId.startsWith('f_')) {
    body.folderIds = [resourceId];
  } else {
    throw new ContractDrift(
      `permanentDeleteTrashItem: unrecognized resource ID prefix: ${resourceId}`,
    );
  }

  await clayFetch(`/workspaces/${workspaceId}/resources/`, {
    method: 'DELETE',
    body: JSON.stringify(body),
  });

  return { success: true };
}

/**
 * Bulk permanently delete multiple items from trash.
 */
export async function bulkPermanentDeleteTrash(
  opts: BulkPermanentDeleteTrashInput,
): Promise<BulkPermanentDeleteTrashOutput> {
  const { workspaceId, tableIds = [], workbookIds = [], folderIds = [] } = opts;

  if (!workspaceId) {
    throw new Validation('bulkPermanentDeleteTrash: workspaceId is required');
  }
  if (
    tableIds.length === 0 &&
    workbookIds.length === 0 &&
    folderIds.length === 0
  ) {
    throw new Validation(
      'bulkPermanentDeleteTrash: at least one of tableIds, workbookIds, or folderIds must be non-empty',
    );
  }

  await clayFetch(`/workspaces/${workspaceId}/resources/`, {
    method: 'DELETE',
    body: JSON.stringify({
      tableIds,
      workbookIds,
      folderIds,
      isPermanentDelete: true,
    }),
  });

  return { success: true };
}
