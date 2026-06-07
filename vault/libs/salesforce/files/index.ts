/**
 * Salesforce File Operations
 *
 * Read and delete operations for Salesforce ContentDocument records via Aura framework API.
 */

import { NotFound } from '@vallum/_runtime';
import { auraAction, DESCRIPTORS, validateString } from '../aura';
import type { AuraContext } from '../aura';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

interface AuraCredentials {
  auraToken: string;
  auraContext: string;
}

interface ContentDocumentRecord {
  Id: string;
  Title: string;
  [key: string]: unknown;
}

interface RowAction {
  devNameOrId: string;
  label: string;
  title: string;
  associatedRecordId: string;
  actionTypeEnum: string;
  targetType: string;
  [key: string]: unknown;
}

interface ListItem {
  record: ContentDocumentRecord;
  actions?: RowAction[];
}

interface ListResult {
  result: ListItem[];
  totalCount: number;
}

interface GetRecordResult {
  record: ContentDocumentRecord;
}

interface RecordUiResult {
  id: string;
  apiName: string;
  fields: Record<string, { displayValue: string | null; value: unknown }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildCtx(creds: AuraCredentials): AuraContext {
  return { token: creds.auraToken, context: creds.auraContext };
}


function isAuraRecord(val: unknown): val is {
  apiName: string;
  id: string;
  fields: Record<string, { value: unknown }>;
} {
  return (
    val != null &&
    typeof val === 'object' &&
    'apiName' in val &&
    'id' in val &&
    'fields' in val
  );
}

function flattenAuraValue(val: unknown): unknown {
  if (!isAuraRecord(val)) return val;
  const flat: Record<string, unknown> = { Id: val.id };
  for (const [key, field] of Object.entries(val.fields)) {
    flat[key] = flattenAuraValue(field.value);
  }
  return flat;
}

function flattenRecordUiFields(
  result: RecordUiResult,
): Record<string, unknown> {
  const record: Record<string, unknown> = { Id: result.id };
  for (const [key, field] of Object.entries(result.fields)) {
    record[key] = flattenAuraValue(field.value);
  }
  return record;
}

// ---------------------------------------------------------------------------
// List Files
// ---------------------------------------------------------------------------

export async function listFiles(
  args: AuraCredentials & {
    pageSize?: number;
    page?: number;
    sortBy?: string;
    layoutType?: 'FULL' | 'COMPACT';
    filterName?: string;
    enableRowActions?: boolean;
  },
): Promise<{
  totalCount: number;
  files: Array<
    ContentDocumentRecord & {
      actions?: Array<{
        name: string;
        label: string;
        recordId: string;
        actionType: string;
      }>;
    }
  >;
}> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');

  const ctx = buildCtx(args);
  const enableActions = args.enableRowActions ?? false;

  const params: Record<string, unknown> = {
    entityNameOrId: 'ContentDocument',
    layoutType: args.layoutType ?? 'FULL',
    pageSize: args.pageSize ?? 25,
    currentPage: args.page ?? 1,
    useTimeout: false,
    getCount: true,
    enableRowActions: enableActions,
  };

  if (args.sortBy != null) {
    params.sortBy = args.sortBy;
  }

  if (args.filterName) {
    params.filterName = args.filterName;
  }

  const raw = await auraAction(ctx, DESCRIPTORS.getItems, params);

  const result = raw as ListResult;

  return {
    totalCount: result.totalCount,
    files: result.result.map((item: ListItem) => {
      const file: ContentDocumentRecord & {
        actions?: Array<{
          name: string;
          label: string;
          recordId: string;
          actionType: string;
        }>;
      } = item.record;
      if (enableActions && item.actions) {
        file.actions = item.actions.map((a) => ({
          name: a.devNameOrId,
          label: a.label,
          recordId: a.associatedRecordId,
          actionType: a.actionTypeEnum,
        }));
      }
      return file;
    }),
  };
}

// ---------------------------------------------------------------------------
// Get File
// ---------------------------------------------------------------------------

export async function getFile(
  args: AuraCredentials & {
    fileId: string;
    layoutType?: 'FULL' | 'COMPACT';
    mode?: 'VIEW' | 'EDIT' | 'CREATE';
    recordTypeId?: string;
    fields?: string[];
    optionalFields?: string[];
  },
): Promise<ContentDocumentRecord> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.fileId, 'fileId');

  const ctx = buildCtx(args);

  // When fields or optionalFields are specified, use RecordUiController/getRecordWithFields
  // which supports field selection. DetailController ignores these params.
  if (args.fields || args.optionalFields) {
    const raw = await auraAction(ctx, DESCRIPTORS.getRecordWithFields, {
      recordId: args.fileId,
      ...(args.fields ? { fields: args.fields } : {}),
      ...(args.optionalFields ? { optionalFields: args.optionalFields } : {}),
    });

    const result = raw as RecordUiResult & { onLoadErrorMessage?: string };

    if (result.onLoadErrorMessage || !result.id) {
      throw new NotFound(
        `getFile: File not found (${args.fileId}). ${result.onLoadErrorMessage ?? ''}`.trim(),
      );
    }

    return flattenRecordUiFields(result) as ContentDocumentRecord;
  }

  const params: Record<string, unknown> = {
    recordId: args.fileId,
    layoutType: args.layoutType ?? 'FULL',
    mode: args.mode ?? 'VIEW',
  };

  if (args.recordTypeId !== undefined) {
    params.recordTypeId = args.recordTypeId;
  }

  const raw = await auraAction(ctx, DESCRIPTORS.getRecord, params);

  const result = raw as GetRecordResult & { onLoadErrorMessage?: string };

  if (result.onLoadErrorMessage || !result.record) {
    throw new NotFound(
      `getFile: File not found (${args.fileId}). ${result.onLoadErrorMessage ?? ''}`.trim(),
    );
  }

  return result.record;
}

// ---------------------------------------------------------------------------
// Delete File
// ---------------------------------------------------------------------------

export async function deleteFile(
  args: AuraCredentials & {
    fileId: string;
  },
): Promise<{ deleted: true; recordId: string }> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.fileId, 'fileId');

  const ctx = buildCtx(args);

  await auraAction(ctx, DESCRIPTORS.deleteRecord, {
    recordId: args.fileId,
  });

  return {
    deleted: true,
    recordId: args.fileId,
  };
}
