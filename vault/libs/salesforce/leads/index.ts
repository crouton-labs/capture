/**
 * Salesforce Lead Operations
 *
 * CRUD operations for Salesforce leads via Aura framework API.
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

interface LeadRecord {
  Id: string;
  LastName: string;
  Company: string;
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
  record: LeadRecord;
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

function flattenListUiRecord(rec: ListUiRecord): LeadRecord {
  const flat: Record<string, unknown> = { Id: rec.id };
  for (const [key, field] of Object.entries(rec.fields)) {
    flat[key] = flattenAuraValue(field.value);
  }
  return flat as LeadRecord;
}

// ---------------------------------------------------------------------------
// List Leads
// ---------------------------------------------------------------------------

export async function listLeads(
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
  leads: LeadRecord[];
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
      'Lead.Id',
      'Lead.Name',
      'Lead.Company',
      'Lead.Email',
      'Lead.Phone',
      'Lead.Status',
      'Lead.Owner.Alias',
      'Lead.OwnerId',
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
    objectApiName: 'Lead',
    listViewApiName: args.listViewApiName ?? 'AllOpenLeads',
    listRecordsQuery,
  });

  const result = raw as ListUiResult;

  return {
    count: result.count,
    leads: result.records.map(flattenListUiRecord),
    nextPageToken: result.nextPageToken ?? null,
    previousPageToken: result.previousPageToken ?? null,
    currentPageToken: result.currentPageToken ?? null,
  };
}

// ---------------------------------------------------------------------------
// Get Lead
// ---------------------------------------------------------------------------

export async function getLead(
  args: AuraCredentials & {
    leadId: string;
    layoutType?: 'FULL' | 'COMPACT';
    mode?: 'VIEW' | 'EDIT' | 'CREATE';
    fields?: string[];
    optionalFields?: string[];
    childRelationships?: string[];
    recordTypeId?: string;
  },
): Promise<LeadRecord> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.leadId, 'leadId');

  const ctx = buildCtx(args);

  // When fields, optionalFields, or childRelationships are specified, use
  // RecordUiController/getRecordWithFields which supports these params.
  // DetailController ignores them.
  if (args.fields || args.optionalFields || args.childRelationships) {
    const raw = await auraAction(ctx, DESCRIPTORS.getRecordWithFields, {
      recordId: args.leadId,
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
        `getLead: record not found for ${args.leadId}. ${result.onLoadErrorMessage ?? ''}`.trim(),
      );
    }

    const record = flattenRecordUiFields(result) as LeadRecord;
    if (
      result.childRelationships &&
      Object.keys(result.childRelationships).length > 0
    ) {
      record.childRelationships = result.childRelationships;
    }
    return record;
  }

  const params: Record<string, unknown> = {
    recordId: args.leadId,
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
      `getLead: record not found for ${args.leadId}. ${result.onLoadErrorMessage ?? ''}`.trim(),
    );
  }

  return result.record;
}

// ---------------------------------------------------------------------------
// Create Lead
// ---------------------------------------------------------------------------

export async function createLead(
  args: AuraCredentials & {
    lastName: string;
    company: string;
    fields?: Record<string, unknown>;
    allowSaveOnDuplicate?: boolean;
    triggerOtherEmail?: boolean;
    triggerUserEmail?: boolean;
    useDefaultRule?: boolean;
    assignmentRuleId?: string;
    triggerAutoResponseEmail?: boolean;
  },
): Promise<{ id: string; record: Record<string, unknown> }> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.lastName, 'lastName');
  validateString(args.company, 'company');

  const ctx = buildCtx(args);

  const fields: Record<string, unknown> = {
    ...args.fields,
    LastName: args.lastName,
    Company: args.company,
  };

  const raw = await auraAction(ctx, DESCRIPTORS.createRecord, {
    recordInput: {
      apiName: 'Lead',
      fields,
      ...(args.allowSaveOnDuplicate != null && {
        allowSaveOnDuplicate: args.allowSaveOnDuplicate,
      }),
    },
    ...(args.triggerOtherEmail != null && {
      triggerOtherEmail: args.triggerOtherEmail,
    }),
    ...(args.triggerUserEmail != null && {
      triggerUserEmail: args.triggerUserEmail,
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
// Update Lead
// ---------------------------------------------------------------------------

export async function updateLead(
  args: AuraCredentials & {
    leadId: string;
    fields: Record<string, unknown>;
    allowSaveOnDuplicate?: boolean;
    ifUnmodifiedSince?: string;
    triggerOtherEmail?: boolean;
    triggerUserEmail?: boolean;
    useDefaultRule?: boolean;
    recordTypeId?: string;
    layoutType?: 'FULL' | 'COMPACT';
    mode?: 'VIEW' | 'EDIT' | 'CREATE';
    optionalFields?: string[];
    childRelationships?: string[];
  },
): Promise<{ id: string; record: Record<string, unknown> }> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.leadId, 'leadId');

  if (!args.fields || Object.keys(args.fields).length === 0) {
    throw new Validation(
      'fields is required and must contain at least one property to update.',
    );
  }

  const ctx = buildCtx(args);

  const params: Record<string, unknown> = {
    recordId: args.leadId,
    recordInput: {
      fields: { ...args.fields },
      ...(args.allowSaveOnDuplicate != null && {
        allowSaveOnDuplicate: args.allowSaveOnDuplicate,
      }),
    },
    ...(args.triggerOtherEmail != null && {
      triggerOtherEmail: args.triggerOtherEmail,
    }),
    ...(args.triggerUserEmail != null && {
      triggerUserEmail: args.triggerUserEmail,
    }),
    ...(args.useDefaultRule != null && {
      useDefaultRule: args.useDefaultRule,
    }),
    ...(args.recordTypeId != null && {
      recordTypeId: args.recordTypeId,
    }),
    ...(args.layoutType != null && {
      layoutType: args.layoutType,
    }),
    ...(args.mode != null && {
      mode: args.mode,
    }),
    ...(args.optionalFields != null && {
      optionalFields: args.optionalFields,
    }),
    ...(args.childRelationships != null && {
      childRelationships: args.childRelationships,
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
// Delete Lead
// ---------------------------------------------------------------------------

export async function deleteLead(
  args: AuraCredentials & {
    leadId: string;
  },
): Promise<{ deleted: true; recordId: string }> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.leadId, 'leadId');

  const ctx = buildCtx(args);

  await auraAction(ctx, DESCRIPTORS.deleteRecord, {
    recordId: args.leadId,
  });

  return {
    deleted: true,
    recordId: args.leadId,
  };
}
