/**
 * Salesforce Opportunity Operations
 *
 * CRUD operations for Salesforce opportunities via Aura framework API.
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

interface OpportunityRecord {
  Id: string;
  Name: string;
  StageName: string;
  CloseDate: string;
  [key: string]: unknown;
}

interface ListResult {
  result: Array<{ record: OpportunityRecord }>;
  totalCount: number;
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
  record: OpportunityRecord;
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

function flattenListUiRecord(rec: ListUiRecord): OpportunityRecord {
  const flat: OpportunityRecord = {
    Id: rec.id,
    Name: '',
    StageName: '',
    CloseDate: '',
  };
  for (const [key, field] of Object.entries(rec.fields)) {
    flat[key] = flattenAuraValue(field.value);
  }
  if (!flat.Name && rec.fields.Name) {
    flat.Name = rec.fields.Name.value as string;
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
// Where-clause helpers
// ---------------------------------------------------------------------------

type RangeOp = 'gt' | 'gte' | 'lt' | 'lte';
const RANGE_OPS = new Set<string>(['gt', 'gte', 'lt', 'lte']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface DateFilter {
  field: string;
  op: RangeOp;
  value: string;
}

/**
 * Salesforce's ListUi API supports range operators (gt/gte/lt/lte) on numeric
 * fields but NOT on date fields. This function splits a where clause into:
 *   - apiWhere: conditions the API can handle (passed server-side)
 *   - dateFilters: date range conditions applied client-side after fetch
 */
function splitDateFilters(whereStr: string): {
  apiWhere: string | null;
  dateFilters: DateFilter[];
} {
  const parsed = JSON.parse(whereStr);
  const dateFilters: DateFilter[] = [];

  function processConditions(
    obj: Record<string, unknown>,
  ): Record<string, unknown> | null {
    const result: Record<string, unknown> = {};
    let hasKeys = false;

    for (const [key, val] of Object.entries(obj)) {
      // Logical combinators: recurse into arrays
      if (key === 'and' || key === 'or') {
        const arr = val as Record<string, unknown>[];
        const filtered = arr
          .map(processConditions)
          .filter((c): c is Record<string, unknown> => c !== null);
        if (filtered.length > 0) {
          result[key] = filtered;
          hasKeys = true;
        }
        continue;
      }
      if (key === 'not') {
        const inner = processConditions(val as Record<string, unknown>);
        if (inner) {
          result[key] = inner;
          hasKeys = true;
        }
        continue;
      }

      // Field-level condition: { "FieldName": { "op": value } }
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        const ops = val as Record<string, unknown>;
        const remaining: Record<string, unknown> = {};
        let hasRemaining = false;

        for (const [op, opVal] of Object.entries(ops)) {
          if (
            RANGE_OPS.has(op) &&
            typeof opVal === 'string' &&
            DATE_RE.test(opVal)
          ) {
            dateFilters.push({ field: key, op: op as RangeOp, value: opVal });
          } else {
            remaining[op] = opVal;
            hasRemaining = true;
          }
        }

        if (hasRemaining) {
          result[key] = remaining;
          hasKeys = true;
        }
        continue;
      }

      // Pass through anything else unchanged
      result[key] = val;
      hasKeys = true;
    }

    return hasKeys ? result : null;
  }

  const cleaned = processConditions(parsed);
  return {
    apiWhere: cleaned ? JSON.stringify(cleaned) : null,
    dateFilters,
  };
}

function applyDateFilters(
  records: OpportunityRecord[],
  filters: DateFilter[],
): OpportunityRecord[] {
  if (filters.length === 0) return records;

  return records.filter((rec) =>
    filters.every((f) => {
      const val = rec[f.field];
      if (typeof val !== 'string') return false;
      // Compare date strings lexicographically (YYYY-MM-DD format)
      switch (f.op) {
        case 'gt':
          return val > f.value;
        case 'gte':
          return val >= f.value;
        case 'lt':
          return val < f.value;
        case 'lte':
          return val <= f.value;
      }
    }),
  );
}

// ---------------------------------------------------------------------------
// List Opportunities
// ---------------------------------------------------------------------------

export async function listOpportunities(
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
  opportunities: OpportunityRecord[];
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
      'Opportunity.Id',
      'Opportunity.Name',
      'Opportunity.Account.Name',
      'Opportunity.AccountId',
      'Opportunity.StageName',
      'Opportunity.CloseDate',
      'Opportunity.Owner.Alias',
      'Opportunity.OwnerId',
    ],
    optionalFields: args.optionalFields ?? [],
    pageSize,
    sortBy: args.sortBy ?? [],
  };

  if (args.searchTerm) {
    listRecordsQuery.searchTerm = args.searchTerm;
  }

  // Split where clause: date range operators (gt/gte/lt/lte on YYYY-MM-DD
  // values) are not supported by Salesforce's ListUi API and must be applied
  // client-side. All other operators are passed to the API.
  let dateFilters: DateFilter[] = [];
  if (args.where) {
    const split = splitDateFilters(args.where);
    dateFilters = split.dateFilters;
    if (split.apiWhere) {
      listRecordsQuery.where = split.apiWhere;
    }
  }

  // Support both legacy page-based and new token-based pagination
  if (args.pageToken != null) {
    listRecordsQuery.pageToken = args.pageToken;
  } else if (args.page != null && args.page > 0) {
    listRecordsQuery.pageToken = String(args.page * pageSize);
  }

  const raw = await auraAction(ctx, DESCRIPTORS.postListRecordsByName, {
    objectApiName: 'Opportunity',
    listViewApiName: args.listViewApiName ?? 'AllOpportunities',
    listRecordsQuery,
  });

  const result = raw as ListUiResult;
  const opportunities = applyDateFilters(
    result.records.map(flattenListUiRecord),
    dateFilters,
  );

  return {
    count: opportunities.length,
    opportunities,
    nextPageToken: result.nextPageToken ?? null,
    previousPageToken: result.previousPageToken ?? null,
    currentPageToken: result.currentPageToken ?? null,
  };
}

// ---------------------------------------------------------------------------
// Get Opportunity
// ---------------------------------------------------------------------------

export async function getOpportunity(
  args: AuraCredentials & {
    opportunityId: string;
    layoutType?: 'FULL' | 'COMPACT';
    mode?: 'VIEW' | 'EDIT' | 'CREATE';
    fields?: string[];
    optionalFields?: string[];
    childRelationships?: string[];
    recordTypeId?: string;
    pageSize?: number;
  },
): Promise<OpportunityRecord> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.opportunityId, 'opportunityId');

  const ctx = buildCtx(args);

  // When fields, optionalFields, or childRelationships are specified, use
  // RecordUiController/getRecordWithFields which supports these params.
  // DetailController ignores them.
  if (args.fields || args.optionalFields || args.childRelationships) {
    const raw = await auraAction(ctx, DESCRIPTORS.getRecordWithFields, {
      recordId: args.opportunityId,
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
        `getOpportunity: record not found for ${args.opportunityId}. ${result.onLoadErrorMessage ?? ''}`.trim(),
      );
    }

    const record = flattenRecordUiFields(result) as OpportunityRecord;
    if (
      result.childRelationships &&
      Object.keys(result.childRelationships).length > 0
    ) {
      record.childRelationships = result.childRelationships;
    }
    return record;
  }

  const raw = await auraAction(ctx, DESCRIPTORS.getRecord, {
    recordId: args.opportunityId,
    layoutType: args.layoutType ?? 'FULL',
    mode: args.mode ?? 'VIEW',
    ...(args.recordTypeId ? { recordTypeId: args.recordTypeId } : {}),
  });

  const result = raw as GetRecordResult & { onLoadErrorMessage?: string };

  if (result.onLoadErrorMessage || !result.record) {
    throw new NotFound(
      `getOpportunity: record not found for ${args.opportunityId}. ${result.onLoadErrorMessage ?? ''}`.trim(),
    );
  }

  return result.record;
}

// ---------------------------------------------------------------------------
// Create Opportunity
// ---------------------------------------------------------------------------

export async function createOpportunity(
  args: AuraCredentials & {
    name: string;
    stageName: string;
    closeDate: string;
    amount?: number;
    probability?: number;
    description?: string;
    nextStep?: string;
    accountId?: string;
    forecastCategoryName?: string;
    ownerId?: string;
    type?: string;
    leadSource?: string;
    fields?: Record<string, unknown>;
  },
): Promise<{ id: string; record: Record<string, unknown> }> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.name, 'name');
  validateString(args.stageName, 'stageName');
  validateString(args.closeDate, 'closeDate');

  const ctx = buildCtx(args);

  const fields: Record<string, unknown> = {
    ...args.fields,
    Name: args.name,
    StageName: args.stageName,
    CloseDate: args.closeDate,
  };
  if (args.amount != null) fields.Amount = args.amount;
  if (args.probability != null) fields.Probability = args.probability;
  if (args.description != null) fields.Description = args.description;
  if (args.nextStep != null) fields.NextStep = args.nextStep;
  if (args.accountId != null) fields.AccountId = args.accountId;
  if (args.forecastCategoryName != null)
    fields.ForecastCategoryName = args.forecastCategoryName;
  if (args.ownerId != null) fields.OwnerId = args.ownerId;
  if (args.type != null) fields.Type = args.type;
  if (args.leadSource != null) fields.LeadSource = args.leadSource;

  const raw = await auraAction(ctx, DESCRIPTORS.createRecord, {
    recordInput: {
      apiName: 'Opportunity',
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
// Update Opportunity
// ---------------------------------------------------------------------------

export async function updateOpportunity(
  args: AuraCredentials & {
    opportunityId: string;
    fields: Record<string, unknown>;
    allowSaveOnDuplicate?: boolean;
    ifUnmodifiedSince?: string;
    triggerOtherEmail?: boolean;
    triggerUserEmail?: boolean;
    useDefaultRule?: boolean;
  },
): Promise<{ id: string; record: Record<string, unknown> }> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.opportunityId, 'opportunityId');

  if (!args.fields || Object.keys(args.fields).length === 0) {
    throw new Validation(
      'fields is required and must contain at least one property to update.',
    );
  }

  const ctx = buildCtx(args);

  const params: Record<string, unknown> = {
    recordId: args.opportunityId,
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
// Delete Opportunity
// ---------------------------------------------------------------------------

export async function deleteOpportunity(
  args: AuraCredentials & {
    opportunityId: string;
  },
): Promise<{ deleted: true; recordId: string }> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.opportunityId, 'opportunityId');

  const ctx = buildCtx(args);

  await auraAction(ctx, DESCRIPTORS.deleteRecord, {
    recordId: args.opportunityId,
  });

  return {
    deleted: true,
    recordId: args.opportunityId,
  };
}

// ---------------------------------------------------------------------------
// List Opportunity Line Items
// ---------------------------------------------------------------------------

export async function listOpportunityLineItems(
  args: AuraCredentials & {
    opportunityId?: string;
    pageSize?: number;
    page?: number;
    sortBy?: string;
    filterName?: string;
  },
): Promise<{
  totalCount: number;
  lineItems: Record<string, unknown>[];
}> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');

  const ctx = buildCtx(args);

  const params: Record<string, unknown> = {
    entityNameOrId: 'OpportunityLineItem',
    layoutType: 'FULL',
    pageSize: args.pageSize ?? 50,
    currentPage: (args.page ?? 0) + 1,
    useTimeout: false,
    getCount: true,
    enableRowActions: false,
  };

  if (args.sortBy != null) {
    params.sortBy = args.sortBy;
  }

  if (args.filterName != null) {
    params.filterName = args.filterName;
  }

  const raw = await auraAction(ctx, DESCRIPTORS.getItems, params);

  const result = raw as ListResult;
  let lineItems = result.result.map((item) => item.record);

  if (args.opportunityId) {
    lineItems = lineItems.filter(
      (item) => item.OpportunityId === args.opportunityId,
    );
  }

  return {
    totalCount: result.totalCount,
    lineItems,
  };
}

// ---------------------------------------------------------------------------
// Add Opportunity Line Item
// ---------------------------------------------------------------------------

export async function addOpportunityLineItem(
  args: AuraCredentials & {
    opportunityId: string;
    pricebookEntryId: string;
    quantity: number;
    unitPrice: number;
    serviceDate?: string;
    description?: string;
    product2Id?: string;
    sortOrder?: number;
    totalPrice?: number;
  },
): Promise<{ id: string; record: Record<string, unknown> }> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.opportunityId, 'opportunityId');
  validateString(args.pricebookEntryId, 'pricebookEntryId');

  if (typeof args.quantity !== 'number') {
    throw new Validation('quantity is required and must be a number.');
  }
  if (typeof args.unitPrice !== 'number') {
    throw new Validation('unitPrice is required and must be a number.');
  }

  const ctx = buildCtx(args);

  const fields: Record<string, unknown> = {
    OpportunityId: args.opportunityId,
    PricebookEntryId: args.pricebookEntryId,
    Quantity: args.quantity,
    UnitPrice: args.unitPrice,
  };
  if (args.serviceDate != null) fields.ServiceDate = args.serviceDate;
  if (args.description != null) fields.Description = args.description;
  if (args.product2Id != null) fields.Product2Id = args.product2Id;
  if (args.sortOrder != null) fields.SortOrder = args.sortOrder;
  if (args.totalPrice != null) fields.TotalPrice = args.totalPrice;

  const raw = await auraAction(ctx, DESCRIPTORS.createRecord, {
    recordInput: {
      apiName: 'OpportunityLineItem',
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
// Remove Opportunity Line Item
// ---------------------------------------------------------------------------

export async function removeOpportunityLineItem(
  args: AuraCredentials & {
    lineItemId: string;
  },
): Promise<{ deleted: true; recordId: string }> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.lineItemId, 'lineItemId');

  const ctx = buildCtx(args);

  await auraAction(ctx, DESCRIPTORS.deleteRecord, {
    recordId: args.lineItemId,
  });

  return {
    deleted: true,
    recordId: args.lineItemId,
  };
}

// ---------------------------------------------------------------------------
// List Opportunity Contact Roles
// ---------------------------------------------------------------------------

export async function listOpportunityContactRoles(
  args: AuraCredentials & {
    pageSize?: number;
    page?: number;
    sortBy?: string;
  },
): Promise<{
  totalCount: number;
  contactRoles: Record<string, unknown>[];
}> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');

  const ctx = buildCtx(args);

  const params: Record<string, unknown> = {
    entityNameOrId: 'OpportunityContactRole',
    layoutType: 'FULL',
    pageSize: args.pageSize ?? 25,
    currentPage: (args.page ?? 0) + 1,
    useTimeout: false,
    getCount: true,
    enableRowActions: false,
  };

  if (args.sortBy != null) {
    params.sortBy = args.sortBy;
  }

  const raw = await auraAction(ctx, DESCRIPTORS.getItems, params);

  const result = raw as ListResult;

  return {
    totalCount: result.totalCount,
    contactRoles: result.result.map((item) => item.record),
  };
}

// ---------------------------------------------------------------------------
// Add Opportunity Contact Role
// ---------------------------------------------------------------------------

export async function addOpportunityContactRole(
  args: AuraCredentials & {
    opportunityId: string;
    contactId: string;
    role?: string;
    isPrimary?: boolean;
  },
): Promise<{ id: string; record: Record<string, unknown> }> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.opportunityId, 'opportunityId');
  validateString(args.contactId, 'contactId');

  const ctx = buildCtx(args);

  const fields: Record<string, unknown> = {
    OpportunityId: args.opportunityId,
    ContactId: args.contactId,
  };
  if (args.role !== undefined) {
    fields.Role = args.role;
  }
  if (args.isPrimary !== undefined) {
    fields.IsPrimary = args.isPrimary;
  }

  const raw = await auraAction(ctx, DESCRIPTORS.createRecord, {
    recordInput: {
      apiName: 'OpportunityContactRole',
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
// Remove Opportunity Contact Role
// ---------------------------------------------------------------------------

export async function removeOpportunityContactRole(
  args: AuraCredentials & {
    contactRoleId: string;
  },
): Promise<{ deleted: true; recordId: string }> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.contactRoleId, 'contactRoleId');

  if (!args.contactRoleId.startsWith('00K')) {
    throw new Validation(
      `removeOpportunityContactRole: contactRoleId must be an OpportunityContactRole ID (starts with "00K"), got "${args.contactRoleId.slice(0, 3)}..."; use listOpportunityContactRoles to find the correct ID`,
    );
  }

  const ctx = buildCtx(args);

  await auraAction(ctx, DESCRIPTORS.deleteRecord, {
    recordId: args.contactRoleId,
  });

  return {
    deleted: true,
    recordId: args.contactRoleId,
  };
}
