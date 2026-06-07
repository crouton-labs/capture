/**
 * Salesforce Contract Operations
 *
 * CRUD operations for Salesforce contracts via Aura framework API.
 */

import { auraAction, DESCRIPTORS, validateString } from '../aura';
import type { AuraContext } from '../aura';
import { Validation, NotFound, ContractDrift } from '@vallum/_runtime';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

interface AuraCredentials {
  auraToken: string;
  auraContext: string;
}

interface ContractRecord {
  Id: string;
  childRelationships?: Record<string, unknown>;
  [key: string]: unknown;
}

interface GetRecordResult {
  record: ContractRecord;
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
// List Contracts
// ---------------------------------------------------------------------------

interface ListResult {
  result: Array<{ record: Record<string, unknown> }>;
  totalCount: number;
}

export async function listContracts(
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
  contracts: ContractRecord[];
}> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');

  const ctx = buildCtx(args);

  const params: Record<string, unknown> = {
    entityNameOrId: 'Contract',
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
  const result = raw as ListResult;

  return {
    totalCount: result.totalCount ?? 0,
    contracts: result.result.map((item) => {
      const rec = item.record as ContractRecord;
      if (args.enableRowActions && (item as Record<string, unknown>).actions) {
        (rec as Record<string, unknown>).rowActions = (
          item as Record<string, unknown>
        ).actions;
      }
      return rec;
    }),
  };
}

// ---------------------------------------------------------------------------
// Get Contract
// ---------------------------------------------------------------------------

export async function getContract(
  args: AuraCredentials & {
    contractId: string;
    layoutType?: 'FULL' | 'COMPACT';
    mode?: 'VIEW' | 'EDIT' | 'CREATE';
    recordTypeId?: string;
    fields?: string[];
    optionalFields?: string[];
    childRelationships?: string[];
    pageSize?: number;
  },
): Promise<ContractRecord> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.contractId, 'contractId');

  const ctx = buildCtx(args);

  // When explicit fields or childRelationships are specified, use
  // RecordUiController/getRecordWithFields for precise field selection.
  if (args.fields || args.childRelationships) {
    const raw = await auraAction(ctx, DESCRIPTORS.getRecordWithFields, {
      recordId: args.contractId,
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
        `getContract: Failed to load record ${args.contractId}. ${result.onLoadErrorMessage ?? 'No record returned.'}`.trim(),
      );
    }

    if (result.apiName !== 'Contract') {
      throw new ContractDrift(
        `getContract: Record ${args.contractId} is a ${result.apiName}, not a Contract. Provide a valid Contract ID.`,
      );
    }

    const record = flattenRecordUiFields(result) as ContractRecord;
    if (
      result.childRelationships &&
      Object.keys(result.childRelationships).length > 0
    ) {
      record.childRelationships = result.childRelationships;
    }
    return record;
  }

  // When optionalFields is specified without explicit fields, use
  // RecordUiController/getRecordWithLayouts which returns all layout-driven
  // fields plus the optional extras in one call. getRecordWithFields would
  // reject optionalFields alone (requires fields or layoutTypes).
  if (args.optionalFields) {
    const layoutMap: Record<string, string> = {
      FULL: 'Full',
      COMPACT: 'Compact',
    };
    const modeMap: Record<string, string> = {
      VIEW: 'View',
      EDIT: 'Edit',
      CREATE: 'Create',
    };
    const raw = await auraAction(ctx, DESCRIPTORS.getRecordWithLayouts, {
      recordId: args.contractId,
      layoutTypes: [layoutMap[args.layoutType ?? 'FULL']],
      modes: [modeMap[args.mode ?? 'VIEW']],
      optionalFields: args.optionalFields,
    });

    const result = raw as RecordUiResult & {
      onLoadErrorMessage?: string;
    };

    if (result.onLoadErrorMessage || !result.id) {
      throw new NotFound(
        `getContract: Failed to load record ${args.contractId}. ${result.onLoadErrorMessage ?? 'No record returned.'}`.trim(),
      );
    }

    if (result.apiName !== 'Contract') {
      throw new ContractDrift(
        `getContract: Record ${args.contractId} is a ${result.apiName}, not a Contract. Provide a valid Contract ID.`,
      );
    }

    return flattenRecordUiFields(result) as ContractRecord;
  }

  const params: Record<string, unknown> = {
    recordId: args.contractId,
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
      `getContract: Failed to load record ${args.contractId}. ${result.onLoadErrorMessage ?? 'No record returned.'}`.trim(),
    );
  }

  const sobjectType = result.record.sobjectType as string | undefined;
  if (sobjectType && sobjectType !== 'Contract') {
    throw new ContractDrift(
      `getContract: Record ${args.contractId} is a ${sobjectType}, not a Contract. Provide a valid Contract ID.`,
    );
  }

  return result.record;
}

// ---------------------------------------------------------------------------
// Create Contract
// ---------------------------------------------------------------------------

export async function createContract(
  args: AuraCredentials & {
    accountId: string;
    status?: string;
    startDate?: string;
    contractTerm?: number;
    ownerId?: string;
    ownerExpirationNotice?: string;
    description?: string;
    specialTerms?: string;
    companySignedId?: string;
    companySignedDate?: string;
    customerSignedId?: string;
    customerSignedDate?: string;
    customerSignedTitle?: string;
    pricebook2Id?: string;
    billingStreet?: string;
    billingCity?: string;
    billingState?: string;
    billingPostalCode?: string;
    billingCountry?: string;
    billingStateCode?: string;
    billingCountryCode?: string;
    shippingStreet?: string;
    shippingCity?: string;
    shippingState?: string;
    shippingPostalCode?: string;
    shippingCountry?: string;
    shippingStateCode?: string;
    shippingCountryCode?: string;
    fields?: Record<string, unknown>;
    allowSaveOnDuplicate?: boolean;
  },
): Promise<{ id: string; record: Record<string, unknown> }> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.accountId, 'accountId');

  const ctx = buildCtx(args);

  const fields: Record<string, unknown> = {
    ...args.fields,
    AccountId: args.accountId,
  };

  if (args.status != null) fields.Status = args.status;
  if (args.startDate != null) fields.StartDate = args.startDate;
  if (args.contractTerm != null) fields.ContractTerm = args.contractTerm;
  if (args.ownerId != null) fields.OwnerId = args.ownerId;
  if (args.ownerExpirationNotice != null)
    fields.OwnerExpirationNotice = args.ownerExpirationNotice;
  if (args.description != null) fields.Description = args.description;
  if (args.specialTerms != null) fields.SpecialTerms = args.specialTerms;
  if (args.companySignedId != null)
    fields.CompanySignedId = args.companySignedId;
  if (args.companySignedDate != null)
    fields.CompanySignedDate = args.companySignedDate;
  if (args.customerSignedId != null)
    fields.CustomerSignedId = args.customerSignedId;
  if (args.customerSignedDate != null)
    fields.CustomerSignedDate = args.customerSignedDate;
  if (args.customerSignedTitle != null)
    fields.CustomerSignedTitle = args.customerSignedTitle;
  if (args.pricebook2Id != null) fields.Pricebook2Id = args.pricebook2Id;
  if (args.billingStreet != null) fields.BillingStreet = args.billingStreet;
  if (args.billingCity != null) fields.BillingCity = args.billingCity;
  if (args.billingState != null) fields.BillingState = args.billingState;
  if (args.billingPostalCode != null)
    fields.BillingPostalCode = args.billingPostalCode;
  if (args.billingCountry != null) fields.BillingCountry = args.billingCountry;
  if (args.billingStateCode != null)
    fields.BillingStateCode = args.billingStateCode;
  if (args.billingCountryCode != null)
    fields.BillingCountryCode = args.billingCountryCode;
  if (args.shippingStreet != null) fields.ShippingStreet = args.shippingStreet;
  if (args.shippingCity != null) fields.ShippingCity = args.shippingCity;
  if (args.shippingState != null) fields.ShippingState = args.shippingState;
  if (args.shippingPostalCode != null)
    fields.ShippingPostalCode = args.shippingPostalCode;
  if (args.shippingCountry != null)
    fields.ShippingCountry = args.shippingCountry;
  if (args.shippingStateCode != null)
    fields.ShippingStateCode = args.shippingStateCode;
  if (args.shippingCountryCode != null)
    fields.ShippingCountryCode = args.shippingCountryCode;

  const raw = await auraAction(ctx, DESCRIPTORS.createRecord, {
    recordInput: {
      apiName: 'Contract',
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

// ---------------------------------------------------------------------------
// Update Contract
// ---------------------------------------------------------------------------

export async function updateContract(
  args: AuraCredentials & {
    contractId: string;
    fields: Record<string, unknown>;
    allowSaveOnDuplicate?: boolean;
    ifUnmodifiedSince?: string;
  },
): Promise<{ id: string; record: Record<string, unknown> }> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.contractId, 'contractId');

  if (!args.fields || Object.keys(args.fields).length === 0) {
    throw new Validation(
      'fields is required and must contain at least one property to update.',
    );
  }

  const ctx = buildCtx(args);

  const params: Record<string, unknown> = {
    recordId: args.contractId,
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
// Delete Contract
// ---------------------------------------------------------------------------

export async function deleteContract(
  args: AuraCredentials & {
    contractId: string;
  },
): Promise<{ deleted: true; recordId: string }> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.contractId, 'contractId');

  const ctx = buildCtx(args);

  await auraAction(ctx, DESCRIPTORS.deleteRecord, {
    recordId: args.contractId,
  });

  return {
    deleted: true,
    recordId: args.contractId,
  };
}
