/**
 * Table operations
 */

import { Validation } from '@vallum/_runtime';
import {
  clayFetch,
  fetchFieldMappings,
  type TableData,
  type TableResponse,
  type TableFieldData,
} from './shared';
import type {
  ListTablesOutput,
  GetTableOutput,
  CreateTableOutput,
  RenameTableOutput,
  DuplicateTableOutput,
  ExportTableOutput,
  DeleteTableOutput,
  ListWorkspaceTablesOutput,
  ListWorkbookTablesOutput,
  ListSubroutinesOutput,
} from './schemas';

/**
 * List all tables in a workspace.
 */
export async function listTables(opts: {
  workspaceId: string;
}): Promise<ListTablesOutput> {
  const { workspaceId } = opts;

  if (!workspaceId) {
    throw new Validation('listTables: workspaceId is required');
  }

  const data = await clayFetch<{ results: TableData[] }>(
    `/workspaces/${workspaceId}/tables`,
  );

  const tables = (data.results ?? []).map((t) => ({
    id: t.id,
    workspaceId: t.workspaceId,
    name: t.name,
    description: t.description ?? '',
    type: (t.type ?? 'spreadsheet') as
      | 'spreadsheet'
      | 'people'
      | 'company'
      | 'jobs',
    firstViewId: t.firstViewId ?? null,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    workbookId: t.workbookId,
    createdByUserId: t.createdByUserId,
    ownerId: t.ownerId,
    icon: t.icon,
    parentFolderId: t.parentFolderId,
    tableSettings: t.tableSettings,
    fieldGroupMap: t.fieldGroupMap,
    defaultAccess: t.defaultAccess,
    isSandbox: t.isSandbox,
    isHiddenFromNavigation: t.isHiddenFromNavigation,
    deletedAt: t.deletedAt,
    abilities: t.abilities,
    tags: ((t as unknown as Record<string, unknown>).tags as string[]) ?? [],
  }));

  return {
    tables,
    totalCount: tables.length,
  };
}

/**
 * Get table metadata including fields.
 */
export async function getTable(opts: {
  tableId: string;
}): Promise<GetTableOutput> {
  const { tableId } = opts;

  if (!tableId) {
    throw new Validation('getTable: tableId is required');
  }

  const data = await clayFetch<TableResponse>(`/tables/${tableId}`);
  const t = data.table;

  return {
    id: t.id,
    workspaceId: t.workspaceId,
    name: t.name,
    description: t.description,
    type: t.type as 'spreadsheet' | 'people' | 'company' | 'jobs',
    firstViewId: t.firstViewId,
    fields: t.fields,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    workbookId: t.workbookId,
    createdByUserId: t.createdByUserId,
    ownerId: t.ownerId,
    owner: t.owner,
    icon: t.icon,
    parentFolderId: t.parentFolderId,
    tableSettings: t.tableSettings,
    fieldGroupMap: t.fieldGroupMap,
    defaultAccess: t.defaultAccess,
    isSandbox: t.isSandbox,
    isHiddenFromNavigation: t.isHiddenFromNavigation,
    deletedAt: t.deletedAt,
    abilities: t.abilities,
    views: t.views,
  };
}

/**
 * Create a new table in a workspace.
 */
export async function createTable(opts: {
  name: string;
  workspaceId: string;
  type: 'spreadsheet' | 'people' | 'company' | 'jobs';
  workbookId?: string;
}): Promise<CreateTableOutput> {
  const { name, workspaceId, type, workbookId } = opts;

  if (!name) {
    throw new Validation('name is required');
  }
  if (!workspaceId) {
    throw new Validation('workspaceId is required');
  }
  if (!type) {
    throw new Validation('type is required');
  }

  const payload: Record<string, unknown> = {
    name,
    workspaceId: String(workspaceId),
    type,
  };

  if (workbookId) {
    payload.workbookId = workbookId;
  }

  const data = await clayFetch<{
    table: TableData;
    extraData?: {
      initialRecordIds?: string[];
      initialRecords?: unknown[];
      newlyCreatedWorkbook?: {
        id: string;
        name: string;
        workspaceId: number;
        ownerId: string;
        createdAt: string;
      };
    };
  }>('/tables', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  const wb = data.extraData?.newlyCreatedWorkbook;

  return {
    table: {
      ...data.table,
      type: data.table.type as 'spreadsheet' | 'people' | 'company' | 'jobs',
    },
    workbook: wb
      ? {
          id: wb.id,
          name: wb.name,
          isNew: !workbookId,
        }
      : undefined,
    extraData: data.extraData
      ? {
          initialRecordIds: data.extraData.initialRecordIds,
          initialRecords: data.extraData.initialRecords,
          newlyCreatedWorkbook: data.extraData.newlyCreatedWorkbook,
        }
      : undefined,
  };
}

/**
 * Rename a table.
 */
export async function renameTable(opts: {
  tableId: string;
  name: string;
}): Promise<RenameTableOutput> {
  const { tableId, name } = opts;

  if (!tableId) {
    throw new Validation('tableId is required');
  }
  if (!name) {
    throw new Validation('name is required');
  }

  const data = await clayFetch<TableData>(`/tables/${tableId}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });

  return {
    id: data.id,
    name: data.name,
  };
}

/**
 * Duplicate a table.
 */
export async function duplicateTable(opts: {
  tableId: string;
}): Promise<DuplicateTableOutput> {
  const { tableId } = opts;

  if (!tableId) {
    throw new Validation('duplicateTable: tableId is required');
  }

  const data = await clayFetch<{
    table: TableData;
    oldViewIdToNewViewIdMap: Record<string, string>;
  }>(`/tables/${tableId}/duplicate`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

  const t = data.table;

  return {
    table: {
      id: t.id,
      workspaceId: t.workspaceId,
      name: t.name,
      description: t.description,
      type: t.type as 'spreadsheet' | 'people' | 'company' | 'jobs',
      firstViewId: t.firstViewId,
      fields: t.fields,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      workbookId: t.workbookId,
      createdByUserId:
        t.createdByUserId != null ? String(t.createdByUserId) : undefined,
      ownerId: t.ownerId,
      owner: t.owner,
      icon: t.icon,
      parentFolderId: t.parentFolderId,
      tableSettings: t.tableSettings,
      fieldGroupMap: t.fieldGroupMap,
      defaultAccess: t.defaultAccess,
      isSandbox: t.isSandbox,
      isHiddenFromNavigation: t.isHiddenFromNavigation,
      deletedAt: t.deletedAt,
      abilities: t.abilities,
      views: t.views,
    },
    oldViewIdToNewViewIdMap: data.oldViewIdToNewViewIdMap,
  };
}

/**
 * Export a table to downloadable file.
 */
export async function exportTable(opts: {
  tableId: string;
}): Promise<ExportTableOutput> {
  const { tableId } = opts;

  if (!tableId) {
    throw new Validation('tableId is required');
  }

  const data = await clayFetch<{
    id: string;
    workspaceId: number;
    tableId: string;
    viewId: string;
    userId: string;
    fileName: string;
    status: string;
    uploadedFilePath: string | null;
    createdAt: string;
    updatedAt: string;
    totalRecordsInViewCount: number;
    recordsExportedCount: number;
    downloadUrl: string | null;
    settings: Record<string, unknown> | null;
    exportType: string;
  }>(`/tables/${tableId}/export`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

  return {
    id: data.id,
    workspaceId: data.workspaceId,
    tableId: data.tableId,
    viewId: data.viewId,
    userId: data.userId,
    fileName: data.fileName,
    status: data.status,
    uploadedFilePath: data.uploadedFilePath,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    totalRecordsInViewCount: data.totalRecordsInViewCount,
    recordsExportedCount: data.recordsExportedCount,
    downloadUrl: data.downloadUrl,
    settings: data.settings,
    exportType: data.exportType,
  };
}

/**
 * Delete a table via the resources endpoint.
 */
export async function deleteTable(opts: {
  workspaceId: string;
  tableId: string;
  isPermanentDelete?: boolean;
}): Promise<DeleteTableOutput> {
  const { workspaceId, tableId, isPermanentDelete = false } = opts;

  if (!workspaceId) {
    throw new Validation('workspaceId is required');
  }
  if (!tableId) {
    throw new Validation('tableId is required');
  }

  await clayFetch(`/workspaces/${workspaceId}/resources/`, {
    method: 'DELETE',
    body: JSON.stringify({
      tableIds: [tableId],
      workbookIds: [],
      folderIds: [],
      isPermanentDelete,
    }),
  });

  return {
    success: true,
  };
}

/**
 * List tables in a workspace with full metadata.
 */
export async function listWorkspaceTables(opts: {
  workspaceId: string;
}): Promise<ListWorkspaceTablesOutput> {
  const { workspaceId } = opts;

  if (!workspaceId) {
    throw new Validation('listWorkspaceTables: workspaceId is required');
  }

  const data = await clayFetch<{ results: TableData[] }>(
    `/workspaces/${workspaceId}/tables`,
  );

  const tables = (data.results ?? []).map((t) => ({
    id: t.id,
    workspaceId: t.workspaceId,
    name: t.name,
    description: t.description ?? '',
    type: (t.type ?? 'spreadsheet') as
      | 'spreadsheet'
      | 'people'
      | 'company'
      | 'jobs',
    firstViewId: t.firstViewId ?? null,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    workbookId: t.workbookId,
    createdByUserId: t.createdByUserId,
    ownerId: t.ownerId,
    icon: t.icon,
    parentFolderId: t.parentFolderId,
    tableSettings: t.tableSettings,
    fieldGroupMap: t.fieldGroupMap,
    defaultAccess: t.defaultAccess,
    isSandbox: t.isSandbox,
    isHiddenFromNavigation: t.isHiddenFromNavigation,
    deletedAt: t.deletedAt,
    abilities: t.abilities,
    tags: ((t as unknown as Record<string, unknown>).tags as string[]) ?? [],
  }));

  return {
    tables,
    totalCount: tables.length,
  };
}

/**
 * List tables in a workbook.
 */
export async function listWorkbookTables(opts: {
  workbookId: string;
}): Promise<ListWorkbookTablesOutput> {
  const { workbookId } = opts;

  if (!workbookId) {
    throw new Validation('listWorkbookTables: workbookId is required');
  }

  const data = await clayFetch<TableData[]>(`/workbooks/${workbookId}/tables`);

  const tables = (data ?? []).map((t) => ({
    id: t.id,
    workspaceId: t.workspaceId,
    name: t.name,
    description: t.description,
    type: t.type as 'spreadsheet' | 'people' | 'company' | 'jobs',
    firstViewId: t.firstViewId,
    fields: t.fields,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    workbookId: t.workbookId,
    createdByUserId: t.createdByUserId,
    ownerId: t.ownerId,
    owner: t.owner,
    icon: t.icon,
    parentFolderId: t.parentFolderId,
    tableSettings: t.tableSettings,
    fieldGroupMap: t.fieldGroupMap,
    defaultAccess: t.defaultAccess,
    isSandbox: t.isSandbox,
    isHiddenFromNavigation: t.isHiddenFromNavigation,
    deletedAt: t.deletedAt,
    abilities: t.abilities,
    views: t.views,
  }));

  return {
    tables,
    totalCount: tables.length,
  };
}

/**
 * List subroutines (automated workflows) in a workspace.
 */
export async function listSubroutines(opts: {
  workspaceId: string;
}): Promise<ListSubroutinesOutput> {
  const { workspaceId } = opts;

  if (!workspaceId) {
    throw new Validation('listSubroutines: workspaceId is required');
  }

  const data = await clayFetch<{
    subroutines: Array<{
      sourceId: string;
      table: TableData;
      cost: number;
      referenceCount: number;
    }>;
  }>(`/workspaces/${workspaceId}/subroutines`);

  const subroutines = (data.subroutines ?? []).map((s) => ({
    sourceId: s.sourceId,
    table: {
      id: s.table.id,
      workspaceId: s.table.workspaceId,
      createdByUserId: s.table.createdByUserId ?? '',
      name: s.table.name,
      description: s.table.description ?? '',
      type: s.table.type ?? 'spreadsheet',
      icon: s.table.icon ?? null,
      parentFolderId: s.table.parentFolderId ?? null,
      tableSettings: s.table.tableSettings as {
        BLOCK_TYPE: 'SUBROUTINE';
        SUBROUTINE_INPUTS: Array<{
          inputName: string;
          optional: boolean;
          formulaReplacementTarget: string;
        }>;
        IS_PASS_THROUGH_TABLE: boolean;
        PASS_THROUGH_TABLE_SUCCESS_FIELD_IDS: string[];
      },
      createdAt: s.table.createdAt,
      updatedAt: s.table.updatedAt,
      deletedAt: s.table.deletedAt ?? null,
      fieldGroupMap: (s.table.fieldGroupMap ?? {}) as Record<string, unknown>,
      workbookId: s.table.workbookId ?? null,
      defaultAccess: s.table.defaultAccess ?? 'all',
      ownerId: s.table.ownerId ?? '',
      isSandbox: s.table.isSandbox ?? false,
      isHiddenFromNavigation: s.table.isHiddenFromNavigation ?? false,
      firstViewId: s.table.firstViewId ?? '',
      owner: s.table.owner ?? null,
    },
    cost: s.cost,
    referenceCount: s.referenceCount,
  }));

  return {
    subroutines,
    totalCount: subroutines.length,
  };
}

// ============================================================================
// Send to Table (route-row action)
// ============================================================================

/**
 * Send data from one table to another, optionally exploding list fields into
 * one row per list item. This is the programmatic equivalent of Clay's
 * "Send table data" / "Send to Table" UI action.
 *
 * The workflow:
 * 1. Create a destination table (or use an existing one)
 * 2. Create a "route-row" action field on the source table
 * 3. Run the action field to send data to the destination
 *
 * For list mode: each row in the source table that has a list in the
 * specified field will produce one row per list item in the destination.
 */
export async function sendToTable(opts: {
  sourceTableId: string;
  workspaceId: string;
  destinationTableId?: string;
  destinationTableName?: string;
  workbookId?: string;
  fieldMapping: Record<string, string>;
  mode?: 'row' | 'list';
  listFieldId?: string;
  listPath?: string;
  viewId?: string;
  numRecords?: number;
  recordIds?: string[];
  runImmediately?: boolean;
}): Promise<{
  destinationTableId: string;
  destinationTableCreated: boolean;
  routeFieldId: string;
  workbookId: string | null;
  ran: boolean;
  successes: number;
  errors: number;
}> {
  const {
    sourceTableId,
    workspaceId,
    fieldMapping,
    mode = 'row',
    listFieldId,
    listPath,
    runImmediately = true,
  } = opts;
  if (!sourceTableId) throw new Validation('sendToTable: sourceTableId is required');
  if (!workspaceId) throw new Validation('sendToTable: workspaceId is required');
  if (!fieldMapping || Object.keys(fieldMapping).length === 0) {
    throw new Validation(
      'sendToTable: fieldMapping is required (at least one mapping)',
    );
  }
  if (mode === 'list' && !listFieldId) {
    throw new Validation('sendToTable: listFieldId is required when mode is "list"');
  }

  // Resolve source field names → IDs for the formulaMap
  const { nameToId } = await fetchFieldMappings(sourceTableId);

  // Build the formulaMap: destination column name → source field formula
  const formulaMap: Record<string, string> = {};
  for (const [destColumnName, sourceRef] of Object.entries(fieldMapping)) {
    // If sourceRef looks like a field ID (f_xxx), use it directly
    if (sourceRef.startsWith('f_') || sourceRef.startsWith('{{')) {
      const fieldRef = sourceRef.startsWith('{{')
        ? sourceRef
        : `{{${sourceRef}}}`;
      formulaMap[destColumnName] = fieldRef;
    } else {
      // It's a field name; resolve to ID
      const fieldId = nameToId[sourceRef];
      if (!fieldId) {
        throw new Validation(
          `sendToTable: source field "${sourceRef}" not found in table ${sourceTableId}. Available fields: ${Object.keys(nameToId).join(', ')}`,
        );
      }
      formulaMap[destColumnName] = `{{${fieldId}}}`;
    }
  }

  // Step 1: Create or use destination table
  let destinationTableId = opts.destinationTableId;
  let destinationTableCreated = false;
  let workbookId = opts.workbookId ?? null;

  if (!destinationTableId) {
    // Look up workbookId from source table if not provided
    if (!workbookId) {
      const sourceTable = await clayFetch<TableResponse>(
        `/tables/${sourceTableId}`,
      );
      workbookId = sourceTable.table.workbookId ?? null;
    }

    const tableName = opts.destinationTableName || 'New table';

    const createPayload: Record<string, unknown> = {
      workspaceId: String(workspaceId),
      type: 'spreadsheet',
      name: tableName,
      callerName: 'routing action',
      sourceSettings: {},
    };
    if (workbookId) {
      createPayload.workbookId = workbookId;
    }

    const created = await clayFetch<{
      table: TableData;
      extraData?: { newlyCreatedWorkbook?: { id: string } };
    }>('/tables', {
      method: 'POST',
      body: JSON.stringify(createPayload),
    });

    destinationTableId = created.table.id;
    destinationTableCreated = true;
    if (!workbookId && created.table.workbookId) {
      workbookId = created.table.workbookId;
    }
  }

  // Step 2: Build inputsBinding for route-row action
  const inputsBinding: Array<Record<string, unknown>> = [
    {
      name: 'tableId',
      formulaText: `"${destinationTableId}"`,
      optional: false,
    },
    {
      name: 'rowData',
      formulaMap,
    },
  ];

  // Only include type/listData for list mode (row mode omits type per UI behavior)
  if (mode === 'list') {
    inputsBinding.push({
      name: 'type',
      formulaText: `"list"`,
    });
    if (listFieldId) {
      const resolvedListFieldId = listFieldId.startsWith('f_')
        ? listFieldId
        : nameToId[listFieldId];
      if (!resolvedListFieldId) {
        throw new Validation(
          `sendToTable: list field "${listFieldId}" not found in table ${sourceTableId}`,
        );
      }
      const path = listPath || 'results';
      inputsBinding.push({
        name: 'listData',
        formulaText: `{{${resolvedListFieldId}}}?.${path}`,
      });
    }
  }

  // Step 3: Create the route-row action field on the source table
  // Use a unique field name to avoid 400 on duplicate calls
  const fieldName = opts.destinationTableName
    ? `Send to: ${opts.destinationTableName}`
    : `Send table data ${Date.now()}`;
  const fieldPayload = {
    type: 'action',
    name: fieldName,
    typeSettings: {
      actionKey: 'route-row',
      actionPackageId: 'b1ab3d5d-b0db-4b30-9251-3f32d8b103c1',
      actionVersion: 1,
      inputsBinding,
      dataTypeSettings: { type: 'json' },
    },
  };

  const fieldResp = await clayFetch<{ field: TableFieldData }>(
    `/tables/${sourceTableId}/fields`,
    {
      method: 'POST',
      body: JSON.stringify(fieldPayload),
    },
  );

  const routeFieldId = fieldResp.field.id;

  // Step 4: Optionally run the action
  let ran = false;
  if (runImmediately) {
    const runPayload: Record<string, unknown> = {
      fieldIds: [routeFieldId],
      callerName: 'API',
    };

    if (opts.recordIds && opts.recordIds.length > 0) {
      runPayload.runRecords = { recordIds: opts.recordIds };
    } else if (opts.viewId) {
      runPayload.runRecords = {
        viewIdTopRecords: {
          viewId: opts.viewId,
          numRecords: opts.numRecords ?? 100,
        },
      };
    } else {
      // Get the default view from the source table
      const sourceInfo = await clayFetch<{
        table: TableData & { views?: Array<{ id: string }> };
      }>(`/tables/${sourceTableId}`);
      const defaultViewId =
        sourceInfo.table.firstViewId ?? sourceInfo.table.views?.[0]?.id;
      if (defaultViewId) {
        runPayload.runRecords = {
          viewIdTopRecords: {
            viewId: defaultViewId,
            numRecords: opts.numRecords ?? 100,
          },
        };
      } else {
        runPayload.runRecords = { viewId: undefined };
      }
    }

    await clayFetch(`/tables/${sourceTableId}/run`, {
      method: 'PATCH',
      body: JSON.stringify(runPayload),
    });
    ran = true;
  }

  // Poll status briefly to surface errors
  let successes = 0;
  let errors = 0;
  if (ran) {
    // Wait a moment for the action to start processing
    await new Promise((r) => setTimeout(r, 3000));

    // Get the view ID for status lookup
    const statusTable = await clayFetch<{
      table: TableData & { views?: Array<{ id: string }> };
    }>(`/tables/${sourceTableId}`);
    const statusViewId =
      statusTable.table.firstViewId ?? statusTable.table.views?.[0]?.id;

    if (statusViewId) {
      try {
        const statusResp = await clayFetch<{
          statusCounts: Array<{
            status: string | null;
            count: number;
            staleCount: number;
          }>;
        }>(
          `/tables/${sourceTableId}/views/${statusViewId}/fields/${routeFieldId}/runstatus`,
        );
        for (const entry of statusResp.statusCounts) {
          if (entry.status === 'SUCCESS') {
            successes += entry.count;
          } else if (entry.status && entry.status.startsWith('ERROR')) {
            errors += entry.count;
          }
        }
      } catch {
        // Status endpoint may 404 if field isn't ready yet; not fatal
      }
    }
  }

  return {
    destinationTableId,
    destinationTableCreated,
    routeFieldId,
    workbookId,
    ran,
    successes,
    errors,
  };
}
