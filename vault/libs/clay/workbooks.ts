/**
 * Workbook operations
 */

import { Validation } from '@vallum/_runtime';
import { clayFetch } from './shared';
import type {
  ListWorkbooksOutput,
  CreateWorkbookOutput,
  DeleteWorkbookOutput,
  RenameWorkbookOutput,
  GetWorkbookInput,
  GetWorkbookOutput,
  GetWorkbookOverviewInput,
  GetWorkbookOverviewOutput,
} from './schemas';

interface WorkbookOwner {
  id: number;
  username: string;
  email: string;
  name: string;
  profilePicture?: string | null;
  fullName?: string;
}

interface WorkbookData {
  id: string;
  workspaceId: number;
  name: string;
  description: string | null;
  parentFolderId: string | null;
  settings: Record<string, unknown>;
  annotations: Record<string, unknown>;
  defaultAccess: string;
  ownerId: string | number;
  owner?: WorkbookOwner;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  isHidden: boolean;
  isHiddenFromNavigation: boolean;
  creditLimit: number | null;
  abilities: {
    canDelete?: boolean;
    canUpdate?: boolean;
    canManageAccess?: boolean;
  };
  tags: string[];
}

export async function listWorkbooks(opts: {
  workspaceId: string;
}): Promise<ListWorkbooksOutput> {
  const { workspaceId } = opts;

  if (!workspaceId) {
    throw new Validation('listWorkbooks: workspaceId is required');
  }

  const data = await clayFetch<WorkbookData[]>(
    `/workspaces/${workspaceId}/workbooks`,
  );

  const workbooks = (data || []).map((w) => ({
    id: w.id,
    workspaceId: w.workspaceId,
    name: w.name,
    description: w.description,
    parentFolderId: w.parentFolderId,
    settings: w.settings,
    annotations: w.annotations,
    defaultAccess: w.defaultAccess,
    ownerId: String(w.ownerId),
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
    deletedAt: w.deletedAt,
    isHidden: w.isHidden,
    isHiddenFromNavigation: w.isHiddenFromNavigation,
    creditLimit: w.creditLimit,
    abilities: w.abilities,
    tags: w.tags,
  }));

  return {
    workbooks,
    totalCount: workbooks.length,
  };
}

export async function createWorkbook(opts: {
  name: string;
  workspaceId: string;
  settings?: { isAutoRun?: boolean };
}): Promise<CreateWorkbookOutput> {
  const { name, workspaceId, settings } = opts;

  if (!name) {
    throw new Validation('createWorkbook: name is required');
  }
  if (!workspaceId) {
    throw new Validation('createWorkbook: workspaceId is required');
  }
  if (typeof workspaceId !== 'string') {
    throw new Validation('createWorkbook: workspaceId must be a string');
  }

  const payload: Record<string, unknown> = {
    name,
    workspaceId,
  };
  if (settings && typeof settings === 'object') {
    const sanitized: Record<string, unknown> = {};
    if (typeof settings.isAutoRun === 'boolean') {
      sanitized.isAutoRun = settings.isAutoRun;
    } else if (settings.isAutoRun !== undefined) {
      throw new Validation('createWorkbook: settings.isAutoRun must be a boolean');
    }
    if (Object.keys(sanitized).length > 0) {
      payload.settings = sanitized;
    }
  }

  const data = await clayFetch<WorkbookData>('/workbooks', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  const result: Record<string, unknown> = {
    id: data.id,
    workspaceId: data.workspaceId,
    name: data.name,
    description: data.description,
    parentFolderId: data.parentFolderId,
    settings: data.settings,
    annotations: data.annotations,
    defaultAccess: data.defaultAccess,
    ownerId: String(data.ownerId),
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    deletedAt: data.deletedAt,
    isHidden: data.isHidden,
    isHiddenFromNavigation: data.isHiddenFromNavigation,
    creditLimit: data.creditLimit,
    abilities: data.abilities,
    tags: data.tags,
  };
  if (data.owner) {
    result.owner = data.owner;
  }
  return result as CreateWorkbookOutput;
}

/**
 * Delete a table via the resources endpoint.
 */

export async function deleteWorkbook(opts: {
  workspaceId: string;
  workbookId: string;
}): Promise<DeleteWorkbookOutput> {
  const { workspaceId, workbookId } = opts;

  if (!workspaceId) {
    throw new Validation('workspaceId is required');
  }
  if (!workbookId) {
    throw new Validation('workbookId is required');
  }

  await clayFetch(`/workspaces/${workspaceId}/resources/`, {
    method: 'DELETE',
    body: JSON.stringify({
      tableIds: [],
      workbookIds: [workbookId],
      folderIds: [],
      isPermanentDelete: false,
    }),
  });

  return {
    success: true,
  };
}

export async function renameWorkbook(opts: {
  workspaceId: string;
  workbookId: string;
  name: string;
}): Promise<RenameWorkbookOutput> {
  const { workspaceId, workbookId, name } = opts;

  if (!workspaceId) {
    throw new Validation('renameWorkbook: workspaceId is required');
  }
  if (!workbookId) {
    throw new Validation('renameWorkbook: workbookId is required');
  }
  if (!name) {
    throw new Validation('renameWorkbook: name is required');
  }

  const data = await clayFetch<Record<string, unknown>>(
    `/${workspaceId}/workbooks/${workbookId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    },
  );

  return {
    id: String(data.id ?? workbookId),
    name: String(data.name ?? name),
  };
}

/**
 * Move workbooks to a folder.
 */

export async function getWorkbook(
  params: GetWorkbookInput,
): Promise<GetWorkbookOutput> {
  const { workspaceId, workbookId } = params;

  if (!workspaceId) {
    throw new Validation('getWorkbook: workspaceId is required');
  }
  if (!workbookId) {
    throw new Validation('getWorkbook: workbookId is required');
  }

  const data = await clayFetch<
    WorkbookData & {
      orderedWorkbookTables?: Array<{
        id: string;
        name: string;
        tableType: string;
        blockType?: string;
        firstViewId?: string | null;
      }>;
    }
  >(`/${workspaceId}/workbooks/${workbookId}`);

  return {
    id: data.id,
    workspaceId: data.workspaceId,
    name: data.name,
    description: data.description,
    parentFolderId: data.parentFolderId,
    settings: data.settings,
    annotations: data.annotations,
    defaultAccess: data.defaultAccess,
    ownerId: String(data.ownerId),
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    deletedAt: data.deletedAt,
    isHidden: data.isHidden,
    isHiddenFromNavigation: data.isHiddenFromNavigation,
    creditLimit: data.creditLimit,
    abilities: data.abilities,
    owner: data.owner,
    tags: data.tags,
    orderedWorkbookTables: (data.orderedWorkbookTables || []).map((t) => ({
      id: t.id,
      name: t.name,
      tableType: t.tableType,
      ...(t.blockType ? { blockType: t.blockType } : {}),
      ...(t.firstViewId !== undefined ? { firstViewId: t.firstViewId } : {}),
    })),
  } as GetWorkbookOutput;
}

export async function getWorkbookOverview(
  params: GetWorkbookOverviewInput,
): Promise<GetWorkbookOverviewOutput> {
  const { workspaceId, workbookId } = params;

  if (!workspaceId) {
    throw new Validation('getWorkbookOverview: workspaceId is required');
  }
  if (!workbookId) {
    throw new Validation('getWorkbookOverview: workbookId is required');
  }

  const data = await clayFetch<{
    nodes: Array<Record<string, unknown>>;
    edges: Array<Record<string, unknown>>;
  }>(`/${workspaceId}/workbooks/${workbookId}/overview`);

  return {
    nodes: (data.nodes || []).map((n) => {
      const node: Record<string, unknown> = {
        nodeId: n.nodeId,
        name: n.name,
        creditEstimate: n.creditEstimate ?? null,
        type: n.type,
        recordCount: n.recordCount ?? 0,
      };
      if (n.description !== undefined) node.description = n.description;
      if (n.totalFieldCount !== undefined)
        node.totalFieldCount = n.totalFieldCount;
      if (n.tableDetails) node.tableDetails = n.tableDetails;
      if (n.sendDataFields) node.sendDataFields = n.sendDataFields;
      if (n.action) node.action = n.action;
      if (n.isDisabled !== undefined) node.isDisabled = n.isDisabled;
      if (n.tableId) node.tableId = n.tableId;
      if (n.fieldId) node.fieldId = n.fieldId;
      if (n.sourceId) node.sourceId = n.sourceId;
      if (n.sourceIdentifier) node.sourceIdentifier = n.sourceIdentifier;
      return node;
    }),
    edges: (data.edges || []).map((e) => {
      const edge: Record<string, unknown> = {
        sourceNodeId: e.sourceNodeId,
        targetNodeId: e.targetNodeId,
      };
      if (e.sourceFieldId) edge.sourceFieldId = e.sourceFieldId;
      if (e.type) edge.type = e.type;
      return edge;
    }),
  } as GetWorkbookOverviewOutput;
}
