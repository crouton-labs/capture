/**
 * Record operations
 */

import { Validation } from '@vallum/_runtime';
import {
  clayFetch,
  fetchFieldMappings,
  type BulkFetchResponse,
  type CellData,
  type CreateRecordsResponse,
} from './shared';
import type {
  GetTableRecordsOutput,
  CreateRecordsOutput,
  UpdateRecordsOutput,
  DeleteRecordsOutput,
  ListRecordIdsOutput,
  GetTableRowCountOutput,
  DeleteAllRecordsOutput,
} from './schemas';

export async function getTableRecords(opts: {
  tableId: string;
  recordIds: string[];
}): Promise<GetTableRecordsOutput> {
  const { tableId, recordIds } = opts;

  if (!tableId) {
    throw new Validation('tableId is required');
  }
  if (!recordIds || recordIds.length === 0) {
    throw new Validation('recordIds is required');
  }

  const BATCH_SIZE = 300;

  // Fetch field mappings first
  const mappings = await fetchFieldMappings(tableId);

  // Batch record IDs into chunks of BATCH_SIZE and fetch in parallel
  const batches: string[][] = [];
  for (let i = 0; i < recordIds.length; i += BATCH_SIZE) {
    batches.push(recordIds.slice(i, i + BATCH_SIZE));
  }

  const batchResults = await Promise.all(
    batches.map((batch) =>
      clayFetch<BulkFetchResponse>(`/tables/${tableId}/bulk-fetch-records`, {
        method: 'POST',
        body: JSON.stringify({
          recordIds: batch,
          includeExternalContentFieldIds: [],
        }),
      }),
    ),
  );

  const allResults = batchResults.flatMap((data) => data.results ?? []);

  const records = allResults.map((r) => {
    const cells: Record<string, unknown> = {};
    const cellMetadata: Record<
      string,
      {
        status?: string;
        isCoerced?: boolean;
        isPreview?: boolean;
        isStale?: boolean;
        isOverwrite?: boolean;
        imagePreview?: string;
      }
    > = {};
    for (const [fieldId, cell] of Object.entries(r.cells)) {
      const fieldName = mappings.idToName[fieldId] ?? fieldId;
      cells[fieldName] = cell.value;
      if (cell.metadata && Object.keys(cell.metadata).length > 0) {
        cellMetadata[fieldName] = cell.metadata;
      }
    }
    return {
      id: r.id,
      tableId: r.tableId,
      cells,
      ...(Object.keys(cellMetadata).length > 0 ? { cellMetadata } : {}),
    };
  });

  return {
    records,
    totalCount: records.length,
    fieldMap: mappings.nameToId,
  };
}

export async function createRecords(opts: {
  tableId: string;
  records: Array<{ id?: string; cells?: Record<string, unknown> }>;
}): Promise<CreateRecordsOutput> {
  const { tableId, records } = opts;

  if (!tableId) {
    throw new Validation('tableId is required');
  }
  if (!records || records.length === 0) {
    throw new Validation('records array is required and must not be empty');
  }

  // Catch common mistake: passing 'fields' instead of 'cells'
  for (const r of records as Array<Record<string, unknown>>) {
    if ('fields' in r && !('cells' in r)) {
      throw new Validation(
        'createRecords: use "cells" not "fields" to pass cell data. Each record should have a "cells" object keyed by field name or field ID (f_xxx).',
      );
    }
  }

  // Check if any cell key needs name→ID translation
  const needsTranslation = records.some((r) =>
    r.cells ? Object.keys(r.cells).some((k) => !k.startsWith('f_')) : false,
  );

  let mappings:
    | { nameToId: Record<string, string>; idToName: Record<string, string> }
    | undefined;
  if (needsTranslation) {
    mappings = await fetchFieldMappings(tableId);

    // Collect all field names used across records that don't exist yet
    const missingFieldNames = new Set<string>();
    for (const r of records) {
      if (!r.cells) continue;
      for (const key of Object.keys(r.cells)) {
        if (!key.startsWith('f_') && !mappings.nameToId[key]) {
          missingFieldNames.add(key);
        }
      }
    }

    // Auto-create missing fields only on blank tables (no custom fields).
    // On tables with existing custom fields, throw an error to prevent
    // typos from silently creating new columns.
    if (missingFieldNames.size > 0) {
      const systemFields = new Set(['Created At', 'Updated At']);
      const hasCustomFields = Object.keys(mappings.nameToId).some(
        (name) => !systemFields.has(name),
      );

      if (hasCustomFields) {
        throw new Validation(
          `Unknown field name(s): ${Array.from(missingFieldNames)
            .map((n) => `"${n}"`)
            .join(', ')}. ` +
            `Available fields: ${Object.keys(mappings.nameToId).join(', ')}. ` +
            `Use createField to add new columns first.`,
        );
      }

      for (const fieldName of Array.from(missingFieldNames)) {
        const fieldResp = await clayFetch<{
          field: { id: string; name: string };
        }>(`/tables/${tableId}/fields`, {
          method: 'POST',
          body: JSON.stringify({
            name: fieldName,
            type: 'text',
            typeSettings: { dataTypeSettings: { type: 'text' } },
          }),
        });
        mappings.nameToId[fieldName] = fieldResp.field.id;
        mappings.idToName[fieldResp.field.id] = fieldName;
      }
    }
  }

  const translatedRecords = records.map((r) => {
    if (!r.cells) return { ...r, cells: {} };
    if (!mappings) return r;
    const translatedCells: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(r.cells)) {
      if (key.startsWith('f_')) {
        translatedCells[key] = value;
      } else {
        const fieldId = mappings.nameToId[key];
        if (!fieldId) {
          throw new Validation(
            `Unknown field name "${key}". Available fields: ${Object.keys(mappings.nameToId).join(', ')}`,
          );
        }
        translatedCells[fieldId] = value;
      }
    }
    return { ...r, cells: translatedCells };
  });

  const data = await clayFetch<CreateRecordsResponse>(
    `/tables/${tableId}/records`,
    {
      method: 'POST',
      body: JSON.stringify({ records: translatedRecords }),
    },
  );

  // Translate output cells to field names
  if (
    !mappings &&
    data.records?.some((r) => r.cells && Object.keys(r.cells).length > 0)
  ) {
    mappings = await fetchFieldMappings(tableId);
  }

  const outputRecords = (data.records ?? []).map((r) => {
    if (!mappings) {
      return { id: r.id, tableId: r.tableId, cells: r.cells };
    }
    const cells: Record<string, unknown> = {};
    const cellMetadata: Record<
      string,
      {
        status?: string;
        isCoerced?: boolean;
        isPreview?: boolean;
        isStale?: boolean;
        isOverwrite?: boolean;
        imagePreview?: string;
      }
    > = {};
    for (const [fieldId, cell] of Object.entries(r.cells)) {
      const fieldName = mappings.idToName[fieldId] ?? fieldId;
      cells[fieldName] = (cell as CellData).value;
      const meta = (cell as CellData).metadata;
      if (meta && Object.keys(meta).length > 0) {
        cellMetadata[fieldName] = meta;
      }
    }
    return {
      id: r.id,
      tableId: r.tableId,
      cells,
      ...(Object.keys(cellMetadata).length > 0 ? { cellMetadata } : {}),
    };
  });

  return {
    records: outputRecords,
    totalCount: outputRecords.length,
  };
}

export async function updateRecords(opts: {
  tableId: string;
  records: Array<{ id: string; cells: Record<string, unknown> }>;
}): Promise<UpdateRecordsOutput> {
  const { tableId, records } = opts;

  if (!tableId) {
    throw new Validation('tableId is required');
  }
  if (!records || records.length === 0) {
    throw new Validation('records array is required and must not be empty');
  }

  for (const r of records) {
    if (!r.id) {
      throw new Validation(
        'updateRecords: each record must have an id (r_xxx format)',
      );
    }
    if (!r.cells || typeof r.cells !== 'object') {
      throw new Validation(
        `updateRecords: record "${r.id}" is missing required "cells" object. Provide cell values keyed by field name or field ID.`,
      );
    }
  }

  // Check if any cell key needs name→ID translation
  const needsTranslation = records.some((r) =>
    Object.keys(r.cells).some((k) => !k.startsWith('f_')),
  );

  let translatedRecords = records;
  if (needsTranslation) {
    const mappings = await fetchFieldMappings(tableId);
    translatedRecords = records.map((r) => {
      const translatedCells: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(r.cells)) {
        if (key.startsWith('f_')) {
          translatedCells[key] = value;
        } else {
          const fieldId = mappings.nameToId[key];
          if (!fieldId) {
            throw new Validation(
              `Unknown field name "${key}". Available fields: ${Object.keys(mappings.nameToId).join(', ')}`,
            );
          }
          translatedCells[fieldId] = value;
        }
      }
      return { ...r, cells: translatedCells };
    });
  }

  interface UpdateRecordsResponse {
    records: unknown[];
    message?: string;
    extraData?: {
      message?: string;
    };
  }

  const data = await clayFetch<UpdateRecordsResponse>(
    `/tables/${tableId}/records`,
    {
      method: 'PATCH',
      body: JSON.stringify({ records: translatedRecords }),
    },
  );

  return {
    success: true,
    message:
      data.message ?? data.extraData?.message ?? 'Record updates enqueued',
  };
}

// ============================================================================
// Signals, Claygents, App Accounts, and Workspace Details
// ============================================================================

/**
 * List signals in workspace.
 */

export async function deleteRecords(opts: {
  tableId: string;
  recordIds: string[];
  confirmDeletion: boolean;
}): Promise<DeleteRecordsOutput> {
  const { tableId, recordIds, confirmDeletion } = opts;

  if (confirmDeletion !== true) {
    throw new Validation(
      'deleteRecords requires confirmDeletion: true to prevent accidental deletion. This is a destructive operation.',
    );
  }

  if (!tableId) {
    throw new Validation('tableId is required');
  }
  if (!recordIds || recordIds.length === 0) {
    throw new Validation('recordIds is required');
  }

  const res = await clayFetch(`/tables/${tableId}/records`, {
    method: 'DELETE',
    body: JSON.stringify({ recordIds }),
  });

  return res as Record<string, never>;
}

// ============================================================================
// Record IDs and Row Count
// ============================================================================

interface ListRecordIdsResponse {
  results: string[];
}

/**
 * Get all record IDs in a table view.
 * Use getTable() first to find the viewId (firstViewId on the table response).
 */

export async function listRecordIds(opts: {
  tableId: string;
  viewId: string;
}): Promise<ListRecordIdsOutput> {
  const { tableId, viewId } = opts;

  if (!tableId) {
    throw new Validation('tableId is required');
  }
  if (!viewId) {
    throw new Validation('viewId is required');
  }

  const data = await clayFetch<ListRecordIdsResponse>(
    `/tables/${tableId}/views/${viewId}/records/ids`,
  );

  return {
    recordIds: data.results || [],
  };
}

interface TableRowCountResponse {
  tableTotalRecordsCount: number;
}

/**
 * Count rows in a table.
 */

export async function getTableRowCount(opts: {
  tableId: string;
}): Promise<GetTableRowCountOutput> {
  const { tableId } = opts;

  if (!tableId) {
    throw new Validation('tableId is required');
  }

  const data = await clayFetch<TableRowCountResponse>(
    `/tables/${tableId}/count`,
  );

  return {
    tableTotalRecordsCount: data.tableTotalRecordsCount,
  };
}

/**
 * Bulk delete all rows from a table view.
 * DESTRUCTIVE: Permanently deletes ALL records in a view.
 */

export async function deleteAllRecords(opts: {
  tableId: string;
  viewId: string;
  confirmDeletion: boolean;
  omitRecordIds?: string[];
}): Promise<DeleteAllRecordsOutput> {
  const { tableId, viewId, confirmDeletion, omitRecordIds = [] } = opts;

  if (confirmDeletion !== true) {
    throw new Validation(
      'deleteAllRecords requires confirmDeletion: true to prevent accidental deletion. This is a destructive operation.',
    );
  }

  if (!tableId) {
    throw new Validation('tableId is required');
  }
  if (!viewId) {
    throw new Validation('viewId is required');
  }

  await clayFetch(`/tables/${tableId}/records`, {
    method: 'DELETE',
    body: JSON.stringify({
      deleteAll: true,
      viewId,
      omitDeletingRecordIds: omitRecordIds,
      recordIds: [],
      viewFiltersHash: '',
    }),
  });

  return {
    success: true,
  };
}

// ============================================================================
// Enrichment (Credit-Costing)
// ============================================================================

/**
 * Run enrichment on a field.
 * ⚠️ COSTS CREDITS. Runs enrichment on specified fields for records in a view.
 * ALWAYS get user consent before calling.
 */
