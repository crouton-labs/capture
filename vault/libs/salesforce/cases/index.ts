/**
 * Salesforce Case Operations
 *
 * CRUD operations for Salesforce cases via Aura framework API.
 */

import { auraAction, DESCRIPTORS, validateString } from '../aura';
import type { AuraContext } from '../aura';
import { Validation, NotFound } from '@vallum/_runtime';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

interface AuraCredentials {
  auraToken: string;
  auraContext: string;
}

interface CaseRecord {
  Id: string;
  childRelationships?: Record<string, unknown>;
  [key: string]: unknown;
}

interface ListUiRecord {
  apiName: string;
  id: string;
  fields: Record<string, { displayValue: string | null; value: unknown }>;
}

interface ListUiResult {
  count: number;
  currentPageToken: string | null;
  nextPageToken: string | null;
  previousPageToken: string | null;
  pageSize: number;
  records: ListUiRecord[];
  sortBy: string | null;
  searchTerm: string | null;
}

interface GetRecordResult {
  record: CaseRecord;
}

interface RecordUiResult {
  id: string;
  apiName: string;
  fields: Record<string, { displayValue: string | null; value: unknown }>;
}

interface RelatedListRecordsResult {
  count: number;
  currentPageToken: string | null;
  nextPageToken: string | null;
  previousPageToken: string | null;
  pageSize: number;
  records: ListUiRecord[];
  sortBy: Array<{ fieldApiName: string; isAscending: boolean }>;
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
// List Cases
// ---------------------------------------------------------------------------

function flattenListUiRecord(rec: ListUiRecord): CaseRecord {
  const flat: CaseRecord = { Id: rec.id };
  for (const [key, field] of Object.entries(rec.fields)) {
    flat[key] = flattenAuraValue(field.value);
  }
  return flat;
}

export async function listCases(
  args: AuraCredentials & {
    pageSize?: number;
    page?: number;
    listViewApiName?: string;
    sortBy?: string[];
    searchTerm?: string;
    fields?: string[];
    pageToken?: string;
    optionalFields?: string[];
    where?: string;
  },
): Promise<{
  count: number;
  cases: CaseRecord[];
  nextPageToken: string | null;
  previousPageToken: string | null;
  currentPageToken: string | null;
}> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');

  const ctx = buildCtx(args);

  const pageSize = args.pageSize ?? 25;
  const listRecordsQuery: Record<string, unknown> = {
    fields: args.fields ?? [
      'Case.Id',
      'Case.CaseNumber',
      'Case.Subject',
      'Case.Status',
      'Case.Priority',
      'Case.CreatedDate',
      'Case.Owner.NameOrAlias',
      'Case.OwnerId',
    ],
    optionalFields: args.optionalFields ?? [],
    pageSize,
    sortBy: args.sortBy ?? [],
  };

  if (args.searchTerm) {
    listRecordsQuery.searchTerm = args.searchTerm;
  }

  if (args.where) {
    listRecordsQuery.where = args.where;
  }

  // Support both legacy page-based and new token-based pagination
  if (args.pageToken != null) {
    listRecordsQuery.pageToken = args.pageToken;
  } else if (args.page != null && args.page > 0) {
    listRecordsQuery.pageToken = String(args.page * pageSize);
  }

  const raw = await auraAction(ctx, DESCRIPTORS.postListRecordsByName, {
    objectApiName: 'Case',
    listViewApiName: args.listViewApiName ?? '__Recent',
    listRecordsQuery,
  });

  const result = raw as ListUiResult;

  let cases = result.records.map(flattenListUiRecord);

  // The ListUi API ignores the fields parameter and returns all list view
  // fields regardless. Apply client-side filtering when fields is specified.
  if (args.fields && args.fields.length > 0) {
    const requestedKeys = new Set(
      args.fields.map((f) => {
        // "Case.Subject" → "Subject", "Case.Owner.NameOrAlias" → "Owner"
        const parts = f.split('.');
        return parts.length > 1 ? parts[1] : parts[0];
      }),
    );
    // Always include Id
    requestedKeys.add('Id');

    cases = cases.map((c) => {
      const filtered = {} as CaseRecord;
      for (const key of Array.from(requestedKeys)) {
        if (key in c) {
          (filtered as Record<string, unknown>)[key] = c[key];
        }
      }
      return filtered;
    });
  }

  return {
    count: result.count,
    cases,
    nextPageToken: result.nextPageToken ?? null,
    previousPageToken: result.previousPageToken ?? null,
    currentPageToken: result.currentPageToken ?? null,
  };
}

// ---------------------------------------------------------------------------
// Get Case
// ---------------------------------------------------------------------------

export async function getCase(
  args: AuraCredentials & {
    caseId: string;
    layoutType?: 'FULL' | 'COMPACT';
    mode?: 'VIEW' | 'EDIT' | 'CREATE';
    fields?: string[];
    optionalFields?: string[];
    childRelationships?: string[];
  },
): Promise<CaseRecord> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.caseId, 'caseId');

  const ctx = buildCtx(args);

  // When fields, optionalFields, or childRelationships are specified, use
  // RecordUiController/getRecordWithFields which supports these params.
  // DetailController ignores them.
  if (args.fields || args.optionalFields || args.childRelationships) {
    const raw = await auraAction(ctx, DESCRIPTORS.getRecordWithFields, {
      recordId: args.caseId,
      ...(args.fields ? { fields: args.fields } : {}),
      ...(args.optionalFields ? { optionalFields: args.optionalFields } : {}),
      ...(args.childRelationships
        ? { childRelationships: args.childRelationships }
        : {}),
    });

    const result = raw as RecordUiResult & {
      onLoadErrorMessage?: string;
      childRelationships?: Record<string, unknown>;
    };

    if (result.onLoadErrorMessage || !result.id) {
      throw new NotFound(
        `getCase: record not found for ${args.caseId}. ${result.onLoadErrorMessage ?? ''}`.trim(),
      );
    }

    const record = flattenRecordUiFields(result) as CaseRecord;
    if (
      result.childRelationships &&
      Object.keys(result.childRelationships).length > 0
    ) {
      record.childRelationships = result.childRelationships;
    }
    return record;
  }

  const raw = await auraAction(ctx, DESCRIPTORS.getRecord, {
    recordId: args.caseId,
    layoutType: args.layoutType ?? 'FULL',
    mode: args.mode ?? 'VIEW',
  });

  const result = raw as GetRecordResult & { onLoadErrorMessage?: string };

  if (result.onLoadErrorMessage || !result.record) {
    throw new NotFound(
      `getCase: record not found for ${args.caseId}. ${result.onLoadErrorMessage ?? ''}`.trim(),
    );
  }

  return result.record;
}

// ---------------------------------------------------------------------------
// Create Case
// ---------------------------------------------------------------------------

export async function createCase(
  args: AuraCredentials & {
    fields: Record<string, unknown>;
    allowSaveOnDuplicate?: boolean;
    triggerUserEmail?: boolean;
    triggerOtherEmail?: boolean;
    useDefaultRule?: boolean;
    assignmentRuleId?: string;
    triggerAutoResponseEmail?: boolean;
  },
): Promise<{ id: string; record: Record<string, unknown> }> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');

  if (!args.fields || Object.keys(args.fields).length === 0) {
    throw new Validation(
      'fields is required and must contain at least one property.',
    );
  }

  const ctx = buildCtx(args);

  const raw = await auraAction(ctx, DESCRIPTORS.createRecord, {
    recordInput: {
      apiName: 'Case',
      fields: args.fields,
      ...(args.allowSaveOnDuplicate != null && {
        allowSaveOnDuplicate: args.allowSaveOnDuplicate,
      }),
    },
    ...(args.triggerUserEmail != null && {
      triggerUserEmail: args.triggerUserEmail,
    }),
    ...(args.triggerOtherEmail != null && {
      triggerOtherEmail: args.triggerOtherEmail,
    }),
    ...(args.useDefaultRule != null && {
      useDefaultRule: args.useDefaultRule,
    }),
    ...(args.assignmentRuleId != null && {
      assignmentRuleId: args.assignmentRuleId,
    }),
    ...(args.triggerAutoResponseEmail != null && {
      triggerAutoResponseEmail: args.triggerAutoResponseEmail,
    }),
  });

  const result = raw as RecordUiResult;

  return {
    id: result.id,
    record: flattenRecordUiFields(result),
  };
}

// ---------------------------------------------------------------------------
// Update Case
// ---------------------------------------------------------------------------

export async function updateCase(
  args: AuraCredentials & {
    caseId: string;
    fields: Record<string, unknown>;
    allowSaveOnDuplicate?: boolean;
    ifUnmodifiedSince?: string;
    triggerUserEmail?: boolean;
    triggerOtherEmail?: boolean;
    useDefaultRule?: boolean;
    assignmentRuleId?: string;
    triggerAutoResponseEmail?: boolean;
  },
): Promise<{ id: string; record: Record<string, unknown> }> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.caseId, 'caseId');

  if (!args.fields || Object.keys(args.fields).length === 0) {
    throw new Validation(
      'fields is required and must contain at least one property to update.',
    );
  }

  const ctx = buildCtx(args);

  const params: Record<string, unknown> = {
    recordId: args.caseId,
    recordInput: {
      fields: { ...args.fields },
      ...(args.allowSaveOnDuplicate != null && {
        allowSaveOnDuplicate: args.allowSaveOnDuplicate,
      }),
    },
    ...(args.triggerUserEmail != null && {
      triggerUserEmail: args.triggerUserEmail,
    }),
    ...(args.triggerOtherEmail != null && {
      triggerOtherEmail: args.triggerOtherEmail,
    }),
    ...(args.useDefaultRule != null && {
      useDefaultRule: args.useDefaultRule,
    }),
    ...(args.assignmentRuleId != null && {
      assignmentRuleId: args.assignmentRuleId,
    }),
    ...(args.triggerAutoResponseEmail != null && {
      triggerAutoResponseEmail: args.triggerAutoResponseEmail,
    }),
  };

  if (args.ifUnmodifiedSince) {
    params.clientOptions = { ifUnmodifiedSince: args.ifUnmodifiedSince };
  }

  const raw = await auraAction(ctx, DESCRIPTORS.updateRecord, params);

  const result = raw as RecordUiResult;

  return {
    id: result.id,
    record: flattenRecordUiFields(result),
  };
}

// ---------------------------------------------------------------------------
// List Case Comments
// ---------------------------------------------------------------------------

export async function listCaseComments(
  args: AuraCredentials & {
    caseId: string;
    pageToken?: string;
  },
): Promise<{
  count: number;
  comments: CaseRecord[];
  nextPageToken: string | null;
  previousPageToken: string | null;
  currentPageToken: string | null;
}> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.caseId, 'caseId');

  const ctx = buildCtx(args);

  // Note: pageSize, sortBy, and fields parameters are accepted by the API but
  // silently ignored for CaseComments. Salesforce always returns all comments
  // in newest-first order with pageSize=50. We hardcode the defaults to avoid
  // exposing non-functional params to agents.
  const relatedListRecordsBatchQuery: Record<string, unknown> = {
    fields: [
      'CaseComment.Id',
      'CaseComment.CommentBody',
      'CaseComment.IsPublished',
      'CaseComment.CreatedDate',
      'CaseComment.LastModifiedDate',
      'CaseComment.CreatedById',
    ],
    optionalFields: [],
    pageSize: 50,
    sortBy: [],
  };

  if (args.pageToken != null) {
    relatedListRecordsBatchQuery.pageToken = args.pageToken;
  }

  const raw = await auraAction(ctx, DESCRIPTORS.postRelatedListRecords, {
    parentRecordId: args.caseId,
    relatedListId: 'CaseComments',
    relatedListRecordsBatchQuery,
  });

  const result = raw as RelatedListRecordsResult;

  return {
    count: result.count,
    comments: result.records.map(flattenListUiRecord),
    nextPageToken: result.nextPageToken,
    previousPageToken: result.previousPageToken,
    currentPageToken: result.currentPageToken,
  };
}

// ---------------------------------------------------------------------------
// Add Case Comment
// ---------------------------------------------------------------------------

export async function addCaseComment(
  args: AuraCredentials & {
    caseId: string;
    body: string;
    richtextBody?: string;
    isPublished?: boolean;
  },
): Promise<{ id: string; record: Record<string, unknown> }> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.caseId, 'caseId');
  validateString(args.body, 'body');

  const ctx = buildCtx(args);

  const fields: Record<string, unknown> = {
    ParentId: args.caseId,
    CommentBody: args.body,
    IsPublished: args.isPublished ?? false,
  };

  if (args.richtextBody !== undefined) {
    fields.CommentBodyRichtext = args.richtextBody;
  }

  const raw = await auraAction(ctx, DESCRIPTORS.createRecord, {
    recordInput: {
      apiName: 'CaseComment',
      fields,
    },
  });

  const result = raw as RecordUiResult;

  return {
    id: result.id,
    record: flattenRecordUiFields(result),
  };
}

// ---------------------------------------------------------------------------
// Delete Case
// ---------------------------------------------------------------------------

export async function deleteCase(
  args: AuraCredentials & {
    caseId: string;
  },
): Promise<{ deleted: true; recordId: string }> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.caseId, 'caseId');

  const ctx = buildCtx(args);

  await auraAction(ctx, DESCRIPTORS.deleteRecord, {
    recordId: args.caseId,
  });

  return {
    deleted: true,
    recordId: args.caseId,
  };
}
