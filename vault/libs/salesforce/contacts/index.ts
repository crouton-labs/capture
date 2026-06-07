/**
 * Salesforce Contact Operations
 *
 * CRUD operations for Salesforce contacts via Aura framework API.
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

interface ContactRecord {
  Id: string;
  FirstName: string;
  LastName: string;
  Email: string;
  [key: string]: unknown;
}

interface GetRecordResult {
  record: ContactRecord;
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
// List Contacts
// ---------------------------------------------------------------------------

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

function flattenListUiRecord(rec: ListUiRecord): ContactRecord {
  const flat: Record<string, unknown> = { Id: rec.id };
  for (const [key, field] of Object.entries(rec.fields)) {
    flat[key] = flattenAuraValue(field.value);
  }
  return flat as ContactRecord;
}

export async function listContacts(
  args: AuraCredentials & {
    pageSize?: number;
    page?: number;
    listViewApiName?: string;
    sortBy?: string[];
    searchTerm?: string;
    fields?: string[];
    optionalFields?: string[];
    pageToken?: string;
    where?: string;
  },
): Promise<{
  count: number;
  contacts: ContactRecord[];
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
      'Contact.Id',
      'Contact.Name',
      'Contact.Email',
      'Contact.Phone',
      'Contact.AccountId',
      'Contact.Account.Name',
      'Contact.Owner.Alias',
      'Contact.OwnerId',
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
    objectApiName: 'Contact',
    listViewApiName: args.listViewApiName ?? 'AllContacts',
    listRecordsQuery,
  });

  const result = raw as ListUiResult;

  return {
    count: result.count,
    contacts: result.records.map(flattenListUiRecord),
    nextPageToken: result.nextPageToken ?? null,
    previousPageToken: result.previousPageToken ?? null,
    currentPageToken: result.currentPageToken ?? null,
  };
}

// ---------------------------------------------------------------------------
// Get Contact
// ---------------------------------------------------------------------------

export async function getContact(
  args: AuraCredentials & {
    contactId: string;
    layoutType?: 'FULL' | 'COMPACT';
    mode?: 'VIEW' | 'EDIT' | 'CREATE';
    recordTypeId?: string;
    fields?: string[];
    optionalFields?: string[];
  },
): Promise<ContactRecord> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.contactId, 'contactId');

  const ctx = buildCtx(args);

  // When fields or optionalFields are specified, use RecordUiController/getRecordWithFields
  // which supports field selection. DetailController ignores these params.
  if (args.fields || args.optionalFields) {
    const raw = await auraAction(ctx, DESCRIPTORS.getRecordWithFields, {
      recordId: args.contactId,
      ...(args.fields ? { fields: args.fields } : {}),
      ...(args.optionalFields ? { optionalFields: args.optionalFields } : {}),
    });

    const result = raw as RecordUiResult & { onLoadErrorMessage?: string };

    if (result.onLoadErrorMessage || !result.id) {
      throw new NotFound(
        `getContact: Contact not found (${args.contactId}). ${result.onLoadErrorMessage ?? ''}`.trim(),
      );
    }

    return flattenRecordUiFields(result) as ContactRecord;
  }

  const params: Record<string, unknown> = {
    recordId: args.contactId,
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
      `getContact: Contact not found (${args.contactId}). ${result.onLoadErrorMessage ?? ''}`.trim(),
    );
  }

  return result.record;
}

// ---------------------------------------------------------------------------
// Create Contact
// ---------------------------------------------------------------------------

export async function createContact(
  args: AuraCredentials & {
    lastName: string;
    firstName?: string;
    email?: string;
    fields?: Record<string, unknown>;
    allowSaveOnDuplicate?: boolean;
    triggerOtherEmail?: boolean;
    triggerUserEmail?: boolean;
    useDefaultRule?: boolean;
    assignmentRuleId?: string;
    triggerAutoResponseEmail?: boolean;
    recordTypeId?: string;
    layoutType?: 'FULL' | 'COMPACT';
    mode?: 'VIEW' | 'EDIT' | 'CREATE';
    optionalFields?: string[];
    childRelationships?: string[];
  },
): Promise<{ id: string; record: Record<string, unknown> }> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.lastName, 'lastName');

  const ctx = buildCtx(args);

  const fields: Record<string, unknown> = {
    ...args.fields,
    LastName: args.lastName,
  };

  if (args.firstName !== undefined) {
    fields.FirstName = args.firstName;
  }

  if (args.email !== undefined) {
    fields.Email = args.email;
  }

  const params: Record<string, unknown> = {
    recordInput: {
      apiName: 'Contact',
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

  const raw = await auraAction(ctx, DESCRIPTORS.createRecord, params);

  const result = raw as RecordUiResult;

  return {
    id: result.id,
    record: flattenRecordUiFields(result),
  };
}

// ---------------------------------------------------------------------------
// Update Contact
// ---------------------------------------------------------------------------

export async function updateContact(
  args: AuraCredentials & {
    contactId: string;
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
  validateString(args.contactId, 'contactId');

  if (!args.fields || Object.keys(args.fields).length === 0) {
    throw new Validation(
      'fields is required and must contain at least one property to update.',
    );
  }

  const ctx = buildCtx(args);

  const params: Record<string, unknown> = {
    recordId: args.contactId,
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
// Delete Contact
// ---------------------------------------------------------------------------

export async function deleteContact(
  args: AuraCredentials & {
    contactId: string;
  },
): Promise<{ deleted: true; recordId: string }> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.contactId, 'contactId');

  const ctx = buildCtx(args);

  await auraAction(ctx, DESCRIPTORS.deleteRecord, {
    recordId: args.contactId,
  });

  return {
    deleted: true,
    recordId: args.contactId,
  };
}
