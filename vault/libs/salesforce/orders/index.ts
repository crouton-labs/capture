/**
 * Salesforce Order Operations
 *
 * CRUD operations for Salesforce standard CRM Orders via Aura framework API.
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

interface OrderRecord {
  Id: string;
  AccountId: string;
  EffectiveDate: string;
  Status: string;
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
  record: OrderRecord;
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
// Helpers - List UI
// ---------------------------------------------------------------------------

function flattenListUiRecord(rec: ListUiRecord): OrderRecord {
  const flat: OrderRecord = {
    Id: rec.id,
    AccountId: '',
    EffectiveDate: '',
    Status: '',
  };
  for (const [key, field] of Object.entries(rec.fields)) {
    flat[key] = flattenAuraValue(field.value);
  }
  return flat;
}

// ---------------------------------------------------------------------------
// List Orders
// ---------------------------------------------------------------------------

export async function listOrders(
  args: AuraCredentials & {
    pageSize?: number;
    page?: number;
    pageToken?: string;
    sortBy?: string[];
    listViewApiName?: string;
    searchTerm?: string;
  },
): Promise<{
  count: number;
  orders: OrderRecord[];
  nextPageToken: string | null;
  previousPageToken: string | null;
  currentPageToken: string | null;
}> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');

  const ctx = buildCtx(args);

  const pageSize = args.pageSize ?? 25;
  const listRecordsQuery: Record<string, unknown> = {
    fields: [
      'Order.Id',
      'Order.OrderNumber',
      'Order.AccountId',
      'Order.Account.Name',
      'Order.Status',
      'Order.EffectiveDate',
      'Order.TotalAmount',
      'Order.OwnerId',
      'Order.Owner.Name',
    ],
    optionalFields: [],
    pageSize,
    sortBy: args.sortBy ?? [],
  };

  if (args.searchTerm) {
    listRecordsQuery.searchTerm = args.searchTerm;
  }

  if (args.pageToken != null) {
    listRecordsQuery.pageToken = args.pageToken;
  } else if (args.page != null && args.page > 0) {
    listRecordsQuery.pageToken = String(args.page * pageSize);
  }

  const raw = await auraAction(ctx, DESCRIPTORS.postListRecordsByName, {
    objectApiName: 'Order',
    listViewApiName: args.listViewApiName ?? 'AllOrders',
    listRecordsQuery,
  });

  const result = raw as ListUiResult;

  return {
    count: result.count,
    orders: result.records.map(flattenListUiRecord),
    nextPageToken: result.nextPageToken ?? null,
    previousPageToken: result.previousPageToken ?? null,
    currentPageToken: result.currentPageToken ?? null,
  };
}

// ---------------------------------------------------------------------------
// Get Order
// ---------------------------------------------------------------------------

export async function getOrder(
  args: AuraCredentials & {
    orderId: string;
    layoutType?: 'FULL' | 'COMPACT';
    mode?: 'VIEW' | 'EDIT' | 'CREATE';
    fields?: string[];
    optionalFields?: string[];
    childRelationships?: string[];
    recordTypeId?: string;
  },
): Promise<OrderRecord> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.orderId, 'orderId');

  const ctx = buildCtx(args);

  // When fields, optionalFields, or childRelationships are specified, use
  // RecordUiController/getRecordWithFields which supports these params.
  // DetailController ignores them.
  if (args.fields || args.optionalFields || args.childRelationships) {
    const raw = await auraAction(ctx, DESCRIPTORS.getRecordWithFields, {
      recordId: args.orderId,
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
        `getOrder: Order not found (${args.orderId}). ${result.onLoadErrorMessage ?? ''}`.trim(),
      );
    }

    const record = flattenRecordUiFields(result) as OrderRecord;
    if (
      result.childRelationships &&
      Object.keys(result.childRelationships).length > 0
    ) {
      record.childRelationships = result.childRelationships;
    }
    return record;
  }

  const params: Record<string, unknown> = {
    recordId: args.orderId,
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
      `getOrder: Order not found (${args.orderId}). ${result.onLoadErrorMessage ?? ''}`.trim(),
    );
  }

  return result.record;
}

// ---------------------------------------------------------------------------
// Create Order
// ---------------------------------------------------------------------------

export async function createOrder(
  args: AuraCredentials & {
    accountId: string;
    effectiveDate: string;
    status: string;
    type?: string;
    endDate?: string;
    description?: string;
    contractId?: string;
    pricebook2Id?: string;
    ownerId?: string;
    customerAuthorizedById?: string;
    companyAuthorizedById?: string;
    billingStreet?: string;
    billingCity?: string;
    billingStateCode?: string;
    billingPostalCode?: string;
    billingCountryCode?: string;
    shippingStreet?: string;
    shippingCity?: string;
    shippingStateCode?: string;
    shippingPostalCode?: string;
    shippingCountryCode?: string;
    fields?: Record<string, unknown>;
  },
): Promise<{ id: string; record: Record<string, unknown> }> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.accountId, 'accountId');
  validateString(args.effectiveDate, 'effectiveDate');
  validateString(args.status, 'status');

  const ctx = buildCtx(args);

  const fields: Record<string, unknown> = {
    ...args.fields,
    AccountId: args.accountId,
    EffectiveDate: args.effectiveDate,
    Status: args.status,
  };

  if (args.type != null) fields.Type = args.type;
  if (args.endDate != null) fields.EndDate = args.endDate;
  if (args.description != null) fields.Description = args.description;
  if (args.contractId != null) fields.ContractId = args.contractId;
  if (args.pricebook2Id != null) fields.Pricebook2Id = args.pricebook2Id;
  if (args.ownerId != null) fields.OwnerId = args.ownerId;
  if (args.customerAuthorizedById != null)
    fields.CustomerAuthorizedById = args.customerAuthorizedById;
  if (args.companyAuthorizedById != null)
    fields.CompanyAuthorizedById = args.companyAuthorizedById;
  if (args.billingStreet != null) fields.BillingStreet = args.billingStreet;
  if (args.billingCity != null) fields.BillingCity = args.billingCity;
  if (args.billingStateCode != null)
    fields.BillingStateCode = args.billingStateCode;
  if (args.billingPostalCode != null)
    fields.BillingPostalCode = args.billingPostalCode;
  if (args.billingCountryCode != null)
    fields.BillingCountryCode = args.billingCountryCode;
  if (args.shippingStreet != null) fields.ShippingStreet = args.shippingStreet;
  if (args.shippingCity != null) fields.ShippingCity = args.shippingCity;
  if (args.shippingStateCode != null)
    fields.ShippingStateCode = args.shippingStateCode;
  if (args.shippingPostalCode != null)
    fields.ShippingPostalCode = args.shippingPostalCode;
  if (args.shippingCountryCode != null)
    fields.ShippingCountryCode = args.shippingCountryCode;

  const raw = await auraAction(ctx, DESCRIPTORS.createRecord, {
    recordInput: {
      apiName: 'Order',
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
// Update Order
// ---------------------------------------------------------------------------

export async function updateOrder(
  args: AuraCredentials & {
    orderId: string;
    fields: Record<string, unknown>;
    allowSaveOnDuplicate?: boolean;
    ifUnmodifiedSince?: string;
  },
): Promise<{ id: string; record: Record<string, unknown> }> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.orderId, 'orderId');

  if (!args.fields || Object.keys(args.fields).length === 0) {
    throw new Validation(
      'fields is required and must contain at least one property to update.',
    );
  }

  const ctx = buildCtx(args);

  const params: Record<string, unknown> = {
    recordId: args.orderId,
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
// Delete Order
// ---------------------------------------------------------------------------

export async function deleteOrder(
  args: AuraCredentials & {
    orderId: string;
  },
): Promise<{ deleted: true; recordId: string }> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.orderId, 'orderId');

  const ctx = buildCtx(args);

  await auraAction(ctx, DESCRIPTORS.deleteRecord, {
    recordId: args.orderId,
  });

  return {
    deleted: true,
    recordId: args.orderId,
  };
}
