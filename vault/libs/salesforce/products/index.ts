/**
 * Salesforce Product Operations
 *
 * CRUD operations for Salesforce products via Aura framework API.
 */

import { Validation, NotFound } from '@vallum/_runtime';
import { auraAction, DESCRIPTORS, validateString } from '../aura';
import type { AuraContext } from '../aura';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

interface AuraCredentials {
  auraToken: string;
  auraContext: string;
}

interface ProductRecord {
  Id: string;
  Name: string;
  [key: string]: unknown;
}

interface GetRecordResult {
  record: ProductRecord;
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
// List Products
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

function flattenListUiRecord(rec: ListUiRecord): ProductRecord {
  const flat: ProductRecord = { Id: rec.id, Name: '' };
  for (const [key, field] of Object.entries(rec.fields)) {
    flat[key] = flattenAuraValue(field.value);
  }
  if (!flat.Name && rec.fields.Name) {
    flat.Name = rec.fields.Name.value as string;
  }
  return flat;
}

export async function listProducts(
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
  products: ProductRecord[];
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
      'Product2.Id',
      'Product2.Name',
      'Product2.ProductCode',
      'Product2.IsActive',
      'Product2.Family',
      'Product2.CreatedById',
      'Product2.LastModifiedById',
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
    objectApiName: 'Product2',
    listViewApiName: args.listViewApiName ?? 'AllProducts',
    listRecordsQuery,
  });

  const result = raw as ListUiResult;

  let products = result.records.map(flattenListUiRecord);

  // The ListUi API ignores the fields parameter and returns all list view
  // fields regardless. Apply client-side filtering when fields is specified.
  if (args.fields && args.fields.length > 0) {
    const requestedKeys = new Set(
      args.fields.map((f) => {
        // "Product2.Name" → "Name", "Product2.Owner.Alias" → "Owner"
        const parts = f.split('.');
        return parts.length > 1 ? parts[1] : parts[0];
      }),
    );
    // Always include Id
    requestedKeys.add('Id');

    products = products.map((prod) => {
      const filtered = {} as ProductRecord;
      for (const key of Array.from(requestedKeys)) {
        if (key in prod) {
          (filtered as Record<string, unknown>)[key] = prod[key];
        }
      }
      return filtered;
    });
  }

  return {
    count: result.count,
    products,
    nextPageToken: result.nextPageToken ?? null,
    previousPageToken: result.previousPageToken ?? null,
    currentPageToken: result.currentPageToken ?? null,
  };
}

// ---------------------------------------------------------------------------
// Get Product
// ---------------------------------------------------------------------------

export async function getProduct(
  args: AuraCredentials & {
    productId: string;
    layoutType?: 'FULL' | 'COMPACT';
    mode?: 'VIEW' | 'EDIT' | 'CREATE';
    fields?: string[];
    optionalFields?: string[];
    childRelationships?: string[];
    recordTypeId?: string;
    pageSize?: number;
  },
): Promise<ProductRecord> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.productId, 'productId');

  const ctx = buildCtx(args);

  // When fields, optionalFields, or childRelationships are specified, use
  // RecordUiController/getRecordWithFields which supports these params.
  // DetailController ignores them.
  if (args.fields || args.optionalFields || args.childRelationships) {
    const raw = await auraAction(ctx, DESCRIPTORS.getRecordWithFields, {
      recordId: args.productId,
      ...(args.fields ? { fields: args.fields } : {}),
      ...(args.optionalFields ? { optionalFields: args.optionalFields } : {}),
      ...(args.childRelationships
        ? { childRelationships: args.childRelationships }
        : {}),
      ...(args.recordTypeId ? { recordTypeId: args.recordTypeId } : {}),
      ...(args.pageSize != null ? { pageSize: args.pageSize } : {}),
    });

    const result = raw as RecordUiResult & {
      onLoadErrorMessage?: string;
      childRelationships?: Record<string, unknown>;
    };

    if (result.onLoadErrorMessage || !result.id) {
      throw new NotFound(
        `getProduct: record not found for ${args.productId}. ${result.onLoadErrorMessage ?? ''}`.trim(),
      );
    }

    const record = flattenRecordUiFields(result) as ProductRecord;
    if (
      result.childRelationships &&
      Object.keys(result.childRelationships).length > 0
    ) {
      (record as Record<string, unknown>).childRelationships =
        result.childRelationships;
    }
    return record;
  }

  const raw = await auraAction(ctx, DESCRIPTORS.getRecord, {
    recordId: args.productId,
    layoutType: args.layoutType ?? 'FULL',
    mode: args.mode ?? 'VIEW',
  });

  const result = raw as GetRecordResult & { onLoadErrorMessage?: string };

  if (result.onLoadErrorMessage || !result.record) {
    throw new NotFound(
      `getProduct: record not found for ${args.productId}. ${result.onLoadErrorMessage ?? ''}`.trim(),
    );
  }

  return result.record;
}

// ---------------------------------------------------------------------------
// Create Product
// ---------------------------------------------------------------------------

export async function createProduct(
  args: AuraCredentials & {
    name: string;
    productCode?: string;
    description?: string;
    isActive?: boolean;
    family?: string;
    stockKeepingUnit?: string;
    quantityUnitOfMeasure?: string;
    displayUrl?: string;
    externalId?: string;
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
  validateString(args.name, 'name');

  const ctx = buildCtx(args);

  const fields: Record<string, unknown> = {
    ...args.fields,
    Name: args.name,
  };

  if (args.productCode !== undefined) fields.ProductCode = args.productCode;
  if (args.description !== undefined) fields.Description = args.description;
  if (args.isActive !== undefined) fields.IsActive = args.isActive;
  if (args.family !== undefined) fields.Family = args.family;
  if (args.stockKeepingUnit !== undefined)
    fields.StockKeepingUnit = args.stockKeepingUnit;
  if (args.quantityUnitOfMeasure !== undefined)
    fields.QuantityUnitOfMeasure = args.quantityUnitOfMeasure;
  if (args.displayUrl !== undefined) fields.DisplayUrl = args.displayUrl;
  if (args.externalId !== undefined) fields.ExternalId = args.externalId;

  const params: Record<string, unknown> = {
    recordInput: {
      apiName: 'Product2',
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
// Update Product
// ---------------------------------------------------------------------------

export async function updateProduct(
  args: AuraCredentials & {
    productId: string;
    fields: Record<string, unknown>;
    allowSaveOnDuplicate?: boolean;
    ifUnmodifiedSince?: string;
  },
): Promise<{ id: string; record: Record<string, unknown> }> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.productId, 'productId');

  if (!args.fields || Object.keys(args.fields).length === 0) {
    throw new Validation(
      'fields is required and must contain at least one property to update.',
    );
  }

  const ctx = buildCtx(args);

  const params: Record<string, unknown> = {
    recordId: args.productId,
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
// Delete Product
// ---------------------------------------------------------------------------

export async function deleteProduct(
  args: AuraCredentials & {
    productId: string;
  },
): Promise<{ deleted: true; recordId: string }> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.productId, 'productId');

  const ctx = buildCtx(args);

  await auraAction(ctx, DESCRIPTORS.deleteRecord, {
    recordId: args.productId,
  });

  return {
    deleted: true,
    recordId: args.productId,
  };
}
