/**
 * Salesforce Asset Operations
 *
 * CRUD operations for Salesforce assets via Aura framework API.
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

interface AssetRecord {
  Id: string;
  Name: string;
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
  record: AssetRecord;
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
// List Assets
// ---------------------------------------------------------------------------

function flattenListUiRecord(rec: ListUiRecord): AssetRecord {
  const flat: AssetRecord = { Id: rec.id, Name: '' };
  for (const [key, field] of Object.entries(rec.fields)) {
    flat[key] = flattenAuraValue(field.value);
  }
  if (!flat.Name && rec.fields.Name) {
    flat.Name = rec.fields.Name.value as string;
  }
  return flat;
}

export async function listAssets(
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
  assets: AssetRecord[];
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
      'Asset.Id',
      'Asset.Name',
      'Asset.SerialNumber',
      'Asset.InstallDate',
      'Asset.Account.Name',
      'Asset.AccountId',
      'Asset.Contact.Name',
      'Asset.ContactId',
      'Asset.Product2.Name',
      'Asset.Product2Id',
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

  if (args.pageToken != null) {
    listRecordsQuery.pageToken = args.pageToken;
  } else if (args.page != null && args.page > 0) {
    listRecordsQuery.pageToken = String(args.page * pageSize);
  }

  const raw = await auraAction(ctx, DESCRIPTORS.postListRecordsByName, {
    objectApiName: 'Asset',
    listViewApiName: args.listViewApiName ?? 'AllAssets',
    listRecordsQuery,
  });

  const result = raw as ListUiResult;

  let assets = result.records.map(flattenListUiRecord);

  if (args.fields && args.fields.length > 0) {
    const requestedKeys = new Set(
      args.fields.map((f) => {
        const parts = f.split('.');
        return parts.length > 1 ? parts[1] : parts[0];
      }),
    );
    requestedKeys.add('Id');

    assets = assets.map((a) => {
      const filtered = {} as AssetRecord;
      for (const key of Array.from(requestedKeys)) {
        if (key in a) {
          (filtered as Record<string, unknown>)[key] = a[key];
        }
      }
      return filtered;
    });
  }

  return {
    count: result.count,
    assets,
    nextPageToken: result.nextPageToken ?? null,
    previousPageToken: result.previousPageToken ?? null,
    currentPageToken: result.currentPageToken ?? null,
  };
}

// ---------------------------------------------------------------------------
// Get Asset
// ---------------------------------------------------------------------------

export async function getAsset(
  args: AuraCredentials & {
    assetId: string;
    layoutType?: 'FULL' | 'COMPACT';
    mode?: 'VIEW' | 'EDIT' | 'CREATE';
    fields?: string[];
    optionalFields?: string[];
    childRelationships?: string[];
  },
): Promise<AssetRecord> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.assetId, 'assetId');

  const ctx = buildCtx(args);

  // When fields, optionalFields, or childRelationships are specified, use
  // RecordUiController/getRecordWithFields which supports these params.
  // DetailController ignores them.
  if (args.fields || args.optionalFields || args.childRelationships) {
    const raw = await auraAction(ctx, DESCRIPTORS.getRecordWithFields, {
      recordId: args.assetId,
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
        `getAsset: record not found for ${args.assetId}. ${result.onLoadErrorMessage ?? ''}`.trim(),
      );
    }

    const record = flattenRecordUiFields(result) as AssetRecord;
    if (
      result.childRelationships &&
      Object.keys(result.childRelationships).length > 0
    ) {
      record.childRelationships = result.childRelationships;
    }
    return record;
  }

  const raw = await auraAction(ctx, DESCRIPTORS.getRecord, {
    recordId: args.assetId,
    layoutType: args.layoutType ?? 'FULL',
    mode: args.mode ?? 'VIEW',
  });

  const result = raw as GetRecordResult & { onLoadErrorMessage?: string };

  if (result.onLoadErrorMessage || !result.record) {
    throw new NotFound(
      `getAsset: record not found for ${args.assetId}. ${result.onLoadErrorMessage ?? ''}`.trim(),
    );
  }

  return result.record;
}

// ---------------------------------------------------------------------------
// Create Asset
// ---------------------------------------------------------------------------

export async function createAsset(
  args: AuraCredentials & {
    name: string;
    accountId?: string;
    contactId?: string;
    product2Id?: string;
    serialNumber?: string;
    status?: string;
    price?: number;
    quantity?: number;
    installDate?: string;
    purchaseDate?: string;
    usageEndDate?: string;
    isCompetitorProduct?: boolean;
    description?: string;
    allowSaveOnDuplicate?: boolean;
    fields?: Record<string, unknown>;
  },
): Promise<{ id: string; record: Record<string, unknown> }> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.name, 'name');

  const ctx = buildCtx(args);

  const fields: Record<string, unknown> = {
    ...args.fields,
    Name: args.name,
  };

  if (args.accountId) {
    fields.AccountId = args.accountId;
  }
  if (args.contactId) {
    fields.ContactId = args.contactId;
  }
  if (args.product2Id) {
    fields.Product2Id = args.product2Id;
  }
  if (args.serialNumber !== undefined) {
    fields.SerialNumber = args.serialNumber;
  }
  if (args.status !== undefined) {
    fields.Status = args.status;
  }
  if (args.price !== undefined) {
    fields.Price = args.price;
  }
  if (args.quantity !== undefined) {
    fields.Quantity = args.quantity;
  }
  if (args.installDate !== undefined) {
    fields.InstallDate = args.installDate;
  }
  if (args.purchaseDate !== undefined) {
    fields.PurchaseDate = args.purchaseDate;
  }
  if (args.usageEndDate !== undefined) {
    fields.UsageEndDate = args.usageEndDate;
  }
  if (args.isCompetitorProduct !== undefined) {
    fields.IsCompetitorProduct = args.isCompetitorProduct;
  }
  if (args.description !== undefined) {
    fields.Description = args.description;
  }

  const recordInput: Record<string, unknown> = {
    apiName: 'Asset',
    fields,
  };

  if (args.allowSaveOnDuplicate !== undefined) {
    recordInput.allowSaveOnDuplicate = args.allowSaveOnDuplicate;
  }

  const raw = await auraAction(ctx, DESCRIPTORS.createRecord, {
    recordInput,
  });

  const result = raw as RecordUiResult;

  return {
    id: result.id,
    record: flattenRecordUiFields(result),
  };
}

// ---------------------------------------------------------------------------
// Update Asset
// ---------------------------------------------------------------------------

export async function updateAsset(
  args: AuraCredentials & {
    assetId: string;
    fields: Record<string, unknown>;
    allowSaveOnDuplicate?: boolean;
    ifUnmodifiedSince?: string;
  },
): Promise<{ id: string; record: Record<string, unknown> }> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.assetId, 'assetId');

  if (!args.fields || Object.keys(args.fields).length === 0) {
    throw new Validation(
      'fields is required and must contain at least one property to update.',
    );
  }

  const ctx = buildCtx(args);

  const params: Record<string, unknown> = {
    recordId: args.assetId,
    recordInput: {
      fields: { ...args.fields },
      ...(args.allowSaveOnDuplicate != null && {
        allowSaveOnDuplicate: args.allowSaveOnDuplicate,
      }),
    },
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
// Delete Asset
// ---------------------------------------------------------------------------

export async function deleteAsset(
  args: AuraCredentials & {
    assetId: string;
  },
): Promise<{ deleted: true; recordId: string }> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.assetId, 'assetId');

  const ctx = buildCtx(args);

  await auraAction(ctx, DESCRIPTORS.deleteRecord, {
    recordId: args.assetId,
  });

  return {
    deleted: true,
    recordId: args.assetId,
  };
}
