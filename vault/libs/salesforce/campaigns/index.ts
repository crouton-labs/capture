/**
 * Salesforce Campaign Operations
 *
 * CRUD operations for Salesforce campaigns via Aura framework API.
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

interface CampaignRecord {
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
  record: CampaignRecord;
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

function flattenListUiRecord(rec: ListUiRecord): CampaignRecord {
  const flat: CampaignRecord = { Id: rec.id, Name: '' };
  for (const [key, field] of Object.entries(rec.fields)) {
    flat[key] = flattenAuraValue(field.value);
  }
  if (!flat.Name && rec.fields.Name) {
    flat.Name = rec.fields.Name.value as string;
  }
  return flat;
}

// ---------------------------------------------------------------------------
// List Campaigns
// ---------------------------------------------------------------------------

export async function listCampaigns(
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
  campaigns: CampaignRecord[];
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
      'Campaign.Id',
      'Campaign.Name',
      'Campaign.Type',
      'Campaign.Status',
      'Campaign.StartDate',
      'Campaign.EndDate',
      'Campaign.IsActive',
      'Campaign.Owner.Alias',
      'Campaign.OwnerId',
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
    objectApiName: 'Campaign',
    listViewApiName: args.listViewApiName ?? 'AllActiveCampaigns',
    listRecordsQuery,
  });

  const result = raw as ListUiResult;

  let campaigns = result.records.map(flattenListUiRecord);

  if (args.fields && args.fields.length > 0) {
    const requestedKeys = new Set(
      args.fields.map((f) => {
        const parts = f.split('.');
        return parts.length > 1 ? parts[1] : parts[0];
      }),
    );
    requestedKeys.add('Id');

    campaigns = campaigns.map((c) => {
      const filtered = {} as CampaignRecord;
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
    campaigns,
    nextPageToken: result.nextPageToken,
    previousPageToken: result.previousPageToken,
    currentPageToken: result.currentPageToken,
  };
}

// ---------------------------------------------------------------------------
// Get Campaign
// ---------------------------------------------------------------------------

export async function getCampaign(
  args: AuraCredentials & {
    campaignId: string;
    layoutType?: 'FULL' | 'COMPACT';
    mode?: 'VIEW' | 'EDIT' | 'CREATE';
    fields?: string[];
    optionalFields?: string[];
    childRelationships?: string[];
  },
): Promise<CampaignRecord> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.campaignId, 'campaignId');

  const ctx = buildCtx(args);

  // When fields, optionalFields, or childRelationships are specified, use
  // RecordUiController/getRecordWithFields which supports these params.
  // DetailController ignores them.
  if (args.fields || args.optionalFields || args.childRelationships) {
    const raw = await auraAction(ctx, DESCRIPTORS.getRecordWithFields, {
      recordId: args.campaignId,
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
        `getCampaign: record not found for ${args.campaignId}. ${result.onLoadErrorMessage ?? ''}`.trim(),
      );
    }

    const record = flattenRecordUiFields(result) as CampaignRecord;
    if (
      result.childRelationships &&
      Object.keys(result.childRelationships).length > 0
    ) {
      record.childRelationships = result.childRelationships;
    }
    return record;
  }

  const raw = await auraAction(ctx, DESCRIPTORS.getRecord, {
    recordId: args.campaignId,
    layoutType: args.layoutType ?? 'FULL',
    mode: args.mode ?? 'VIEW',
  });

  const result = raw as GetRecordResult & { onLoadErrorMessage?: string };

  if (result.onLoadErrorMessage || !result.record) {
    throw new NotFound(
      `getCampaign: record not found for ${args.campaignId}. ${result.onLoadErrorMessage ?? ''}`.trim(),
    );
  }

  return result.record;
}

// ---------------------------------------------------------------------------
// Create Campaign
// ---------------------------------------------------------------------------

export async function createCampaign(
  args: AuraCredentials & {
    name: string;
    status?: string;
    type?: string;
    isActive?: boolean;
    description?: string;
    startDate?: string;
    endDate?: string;
    expectedRevenue?: number;
    budgetedCost?: number;
    actualCost?: number;
    numberSent?: number;
    expectedResponse?: number;
    parentId?: string;
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
  if (args.status != null) fields.Status = args.status;
  if (args.type != null) fields.Type = args.type;
  if (args.isActive != null) fields.IsActive = args.isActive;
  if (args.description != null) fields.Description = args.description;
  if (args.startDate != null) fields.StartDate = args.startDate;
  if (args.endDate != null) fields.EndDate = args.endDate;
  if (args.expectedRevenue != null)
    fields.ExpectedRevenue = args.expectedRevenue;
  if (args.budgetedCost != null) fields.BudgetedCost = args.budgetedCost;
  if (args.actualCost != null) fields.ActualCost = args.actualCost;
  if (args.numberSent != null) fields.NumberSent = args.numberSent;
  if (args.expectedResponse != null)
    fields.ExpectedResponse = args.expectedResponse;
  if (args.parentId != null) fields.ParentId = args.parentId;

  const raw = await auraAction(ctx, DESCRIPTORS.createRecord, {
    recordInput: {
      apiName: 'Campaign',
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
// Update Campaign
// ---------------------------------------------------------------------------

export async function updateCampaign(
  args: AuraCredentials & {
    campaignId: string;
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
  validateString(args.campaignId, 'campaignId');

  if (!args.fields || Object.keys(args.fields).length === 0) {
    throw new Validation(
      'fields is required and must contain at least one property to update.',
    );
  }

  const ctx = buildCtx(args);

  const params: Record<string, unknown> = {
    recordId: args.campaignId,
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
// Delete Campaign
// ---------------------------------------------------------------------------

export async function deleteCampaign(
  args: AuraCredentials & {
    campaignId: string;
  },
): Promise<{ deleted: true; recordId: string }> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.campaignId, 'campaignId');

  if (!args.campaignId.startsWith('701')) {
    throw new Validation(
      `deleteCampaign: invalid campaignId "${args.campaignId}". Campaign IDs must start with "701".`,
    );
  }

  const ctx = buildCtx(args);

  await auraAction(ctx, DESCRIPTORS.deleteRecord, {
    recordId: args.campaignId,
  });

  return {
    deleted: true,
    recordId: args.campaignId,
  };
}

// ---------------------------------------------------------------------------
// Related list result types (postRelatedListRecords)
// ---------------------------------------------------------------------------

interface RelatedListRecord {
  apiName: string;
  id: string;
  fields: Record<string, { displayValue: string | null; value: unknown }>;
}

interface RelatedListRecordsResult {
  count: number;
  currentPageToken: string | null;
  nextPageToken: string | null;
  previousPageToken: string | null;
  fields: Array<{ fieldApiName: string; label: string; sortable: boolean }>;
  listReference: { relatedListId: string; inContextOfRecordId: string };
  optionalFields: Array<{
    fieldApiName: string;
    label: string;
    sortable: boolean;
  }>;
  pageSize: number;
  records: RelatedListRecord[];
  sortBy: Array<{ fieldApiName: string; isAscending: boolean }>;
}

// ---------------------------------------------------------------------------
// List Campaign Members
// ---------------------------------------------------------------------------

export async function listCampaignMembers(
  args: AuraCredentials & {
    campaignId: string;
    pageSize?: number;
    pageToken?: string;
    sortBy?: string[];
    fields?: string[];
    optionalFields?: string[];
  },
): Promise<{
  count: number;
  members: CampaignRecord[];
  nextPageToken: string | null;
  previousPageToken: string | null;
  currentPageToken: string | null;
}> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.campaignId, 'campaignId');

  const ctx = buildCtx(args);

  const relatedListRecordsBatchQuery: Record<string, unknown> = {
    fields: args.fields ?? [
      'CampaignMember.Id',
      'CampaignMember.Name',
      'CampaignMember.FirstName',
      'CampaignMember.LastName',
      'CampaignMember.Status',
      'CampaignMember.Title',
      'CampaignMember.CompanyOrAccount',
      'CampaignMember.LeadOrContactId',
      'CampaignMember.Type',
      'CampaignMember.CreatedDate',
      'CampaignMember.LastModifiedDate',
    ],
    optionalFields: args.optionalFields ?? [],
    pageSize: args.pageSize ?? 25,
    sortBy: args.sortBy ?? [],
  };

  if (args.pageToken != null) {
    relatedListRecordsBatchQuery.pageToken = args.pageToken;
  }

  const raw = await auraAction(ctx, DESCRIPTORS.postRelatedListRecords, {
    parentRecordId: args.campaignId,
    relatedListId: 'CampaignMembers',
    relatedListRecordsBatchQuery,
  });

  const result = raw as RelatedListRecordsResult;

  const members = result.records.map(flattenListUiRecord);

  return {
    count: result.count,
    members,
    nextPageToken: result.nextPageToken,
    previousPageToken: result.previousPageToken,
    currentPageToken: result.currentPageToken,
  };
}

// ---------------------------------------------------------------------------
// Add Campaign Member
// ---------------------------------------------------------------------------

export async function addCampaignMember(
  args: AuraCredentials & {
    campaignId: string;
    leadId?: string;
    contactId?: string;
    status: string;
    fields?: Record<string, unknown>;
    allowSaveOnDuplicate?: boolean;
  },
): Promise<{ id: string; record: Record<string, unknown> }> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.campaignId, 'campaignId');
  validateString(args.status, 'status');

  if (!args.leadId && !args.contactId) {
    throw new Validation('Either leadId or contactId is required.');
  }

  const ctx = buildCtx(args);

  const fields: Record<string, unknown> = {
    ...args.fields,
    CampaignId: args.campaignId,
    Status: args.status,
  };

  if (args.leadId) {
    fields.LeadId = args.leadId;
  } else {
    fields.ContactId = args.contactId;
  }

  const raw = await auraAction(ctx, DESCRIPTORS.createRecord, {
    recordInput: {
      apiName: 'CampaignMember',
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
// Remove Campaign Member
// ---------------------------------------------------------------------------

export async function removeCampaignMember(
  args: AuraCredentials & {
    campaignMemberId: string;
  },
): Promise<{ deleted: true; recordId: string }> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.campaignMemberId, 'campaignMemberId');

  if (!args.campaignMemberId.startsWith('00v')) {
    throw new Validation(
      `removeCampaignMember: invalid campaignMemberId "${args.campaignMemberId}". CampaignMember IDs must start with "00v". Use listCampaignMembers to find the correct ID.`,
    );
  }

  const ctx = buildCtx(args);

  await auraAction(ctx, DESCRIPTORS.deleteRecord, {
    recordId: args.campaignMemberId,
  });

  return {
    deleted: true,
    recordId: args.campaignMemberId,
  };
}
