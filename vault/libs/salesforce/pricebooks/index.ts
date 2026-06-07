/**
 * Salesforce Pricebook Operations
 *
 * CRUD operations for Salesforce pricebooks and pricebook entries via Aura framework API.
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

interface PricebookRecord {
  Id: string;
  Name: string;
  [key: string]: unknown;
}

interface PricebookEntryRecord {
  Id: string;
  Name: string;
  Pricebook2Id: string;
  Product2Id: string;
  UnitPrice: number;
  IsActive: boolean;
  [key: string]: unknown;
}

interface ListResult {
  result: Array<{ record: Record<string, unknown> }>;
  totalCount: number;
}

interface GetRecordResult {
  record: PricebookRecord;
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


function flattenRecordUiFields(
  result: RecordUiResult,
): Record<string, unknown> {
  const record: Record<string, unknown> = { Id: result.id };
  for (const [key, field] of Object.entries(result.fields)) {
    record[key] = field.value;
  }
  return record;
}

// ---------------------------------------------------------------------------
// List Pricebooks
// ---------------------------------------------------------------------------

export async function listPricebooks(
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
  pricebooks: PricebookRecord[];
}> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');

  const ctx = buildCtx(args);

  const params: Record<string, unknown> = {
    entityNameOrId: 'Pricebook2',
    layoutType: args.layoutType ?? 'FULL',
    pageSize: args.pageSize ?? 25,
    currentPage: args.page ?? 0,
    useTimeout: false,
    getCount: true,
    enableRowActions: args.enableRowActions ?? false,
  };

  if (args.sortBy !== undefined) {
    params.sortBy = args.sortBy;
  }

  if (args.filterName !== undefined) {
    params.filterName = args.filterName;
  }

  const raw = await auraAction(ctx, DESCRIPTORS.getItems, params);

  const result = raw as {
    result: Array<{
      record: Record<string, unknown>;
      actions?: Array<Record<string, unknown>>;
    }>;
    totalCount: number;
  };

  return {
    totalCount: result.totalCount,
    pricebooks: result.result.map((item) => {
      const rec = item.record as PricebookRecord;
      if (args.enableRowActions && item.actions) {
        (rec as Record<string, unknown>).rowActions = item.actions;
      }
      return rec;
    }),
  };
}

// ---------------------------------------------------------------------------
// Get Pricebook
// ---------------------------------------------------------------------------

export async function getPricebook(
  args: AuraCredentials & {
    pricebookId: string;
    layoutType?: 'FULL' | 'COMPACT';
    mode?: 'VIEW' | 'EDIT' | 'CREATE';
    fields?: string[];
    optionalFields?: string[];
    childRelationships?: string[];
    recordTypeId?: string;
  },
): Promise<PricebookRecord> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.pricebookId, 'pricebookId');

  const ctx = buildCtx(args);

  // When fields, optionalFields, or childRelationships are specified, use
  // RecordUiController/getRecordWithFields which supports these params.
  // DetailController ignores them.
  if (args.fields || args.optionalFields || args.childRelationships) {
    const raw = await auraAction(ctx, DESCRIPTORS.getRecordWithFields, {
      recordId: args.pricebookId,
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
        `getPricebook: Pricebook not found (${args.pricebookId}). ${result.onLoadErrorMessage ?? ''}`.trim(),
      );
    }

    const record = flattenRecordUiFields(result) as PricebookRecord;
    if (
      result.childRelationships &&
      Object.keys(result.childRelationships).length > 0
    ) {
      (record as Record<string, unknown>).childRelationships =
        result.childRelationships;
    }
    return record;
  }

  const params: Record<string, unknown> = {
    recordId: args.pricebookId,
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
      `getPricebook: Pricebook not found (${args.pricebookId}). ${result.onLoadErrorMessage ?? ''}`.trim(),
    );
  }

  return result.record;
}

// ---------------------------------------------------------------------------
// List Pricebook Entries
// ---------------------------------------------------------------------------

export async function listPricebookEntries(
  args: AuraCredentials & {
    pageSize?: number;
    page?: number;
    sortBy?: string;
    layoutType?: 'FULL' | 'COMPACT';
    filterName?: string;
  },
): Promise<{
  totalCount: number;
  entries: PricebookEntryRecord[];
}> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');

  const ctx = buildCtx(args);

  const params: Record<string, unknown> = {
    entityNameOrId: 'PricebookEntry',
    layoutType: args.layoutType ?? 'FULL',
    pageSize: args.pageSize ?? 25,
    currentPage: args.page ?? 0,
    useTimeout: false,
    getCount: true,
    enableRowActions: false,
  };

  if (args.sortBy !== undefined) {
    params.sortBy = args.sortBy;
  }

  if (args.filterName !== undefined) {
    params.filterName = args.filterName;
  }

  const raw = await auraAction(ctx, DESCRIPTORS.getItems, params);

  const result = raw as ListResult;

  return {
    totalCount: result.totalCount,
    entries: result.result.map((item) => item.record as PricebookEntryRecord),
  };
}

// ---------------------------------------------------------------------------
// Create Pricebook Entry
// ---------------------------------------------------------------------------

export async function createPricebookEntry(
  args: AuraCredentials & {
    pricebookId: string;
    productId: string;
    unitPrice: number;
    isActive?: boolean;
    useStandardPrice?: boolean;
    currencyIsoCode?: string;
    allowSaveOnDuplicate?: boolean;
  },
): Promise<{ id: string; record: Record<string, unknown> }> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.pricebookId, 'pricebookId');
  validateString(args.productId, 'productId');

  if (typeof args.unitPrice !== 'number') {
    throw new Validation('unitPrice is required and must be a number.');
  }

  const ctx = buildCtx(args);

  const fields: Record<string, unknown> = {
    Pricebook2Id: args.pricebookId,
    Product2Id: args.productId,
    UnitPrice: args.unitPrice,
    IsActive: args.isActive ?? true,
  };

  if (args.useStandardPrice !== undefined) {
    fields.UseStandardPrice = args.useStandardPrice;
  }

  if (args.currencyIsoCode !== undefined) {
    fields.CurrencyIsoCode = args.currencyIsoCode;
  }

  const raw = await auraAction(ctx, DESCRIPTORS.createRecord, {
    recordInput: {
      apiName: 'PricebookEntry',
      fields,
      ...(args.allowSaveOnDuplicate != null && {
        allowSaveOnDuplicate: args.allowSaveOnDuplicate,
      }),
    },
  });

  const result = raw as RecordUiResult;

  return {
    id: result.id,
    record: flattenRecordUiFields(result),
  };
}
