/**
 * Salesforce Segments & Marketing Operations
 *
 * Segment listing, lead conversion, consent imports, and subscription
 * management via Aura framework API.
 */

import { auraAction, auraRequest, DESCRIPTORS, validateString } from '../aura';
import type { AuraContext, AuraAction } from '../aura';
import { ContractDrift, NotFound, UpstreamError, Validation } from '@vallum/_runtime';
import type {
  ListSegmentsInput,
  ListSegmentsOutput,
  ConvertLeadInput,
  ConvertLeadOutput,
  ListConsentImportsInput,
  ListConsentImportsOutput,
  ListSubscriptionsInput,
  ListSubscriptionsOutput,
  GetSegmentInput,
  GetSegmentOutput,
  CreateSegmentInput,
  CreateSegmentOutput,
  UpdateSegmentInput,
  UpdateSegmentOutput,
  DeleteSegmentInput,
  DeleteSegmentOutput,
} from '../schemas';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

interface AuraCredentials {
  auraToken: string;
  auraContext: string;
}

interface GetRecordResult {
  record: { Id: string; [key: string]: unknown };
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

function flattenListUiRecord(rec: ListUiRecord): {
  Id: string;
  [k: string]: unknown;
} {
  const flat: { Id: string; [k: string]: unknown } = { Id: rec.id };
  for (const [key, field] of Object.entries(rec.fields)) {
    flat[key] = flattenAuraValue(field.value);
  }
  return flat;
}

export async function listSegments(
  args: ListSegmentsInput,
): Promise<ListSegmentsOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');

  const ctx = buildCtx(args);

  // Verify the MarketSegment object is accessible before listing.
  try {
    await auraAction(ctx, DESCRIPTORS.getObjectInfo, {
      objectApiName: 'MarketSegment',
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new UpstreamError(
      `listSegments: MarketSegment object is not accessible in this org. Original error: ${msg}`,
    );
  }

  const pageSize = args.pageSize ?? 25;
  const listRecordsQuery: Record<string, unknown> = {
    fields: args.fields ?? ['MarketSegment.Id', 'MarketSegment.Name'],
    optionalFields: args.optionalFields ?? [],
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
    objectApiName: 'MarketSegment',
    listViewApiName: args.listViewApiName ?? '__Recent',
    listRecordsQuery,
  });

  const result = raw as ListUiResult;

  return {
    count: result.count,
    segments: result.records.map(flattenListUiRecord),
    nextPageToken: result.nextPageToken ?? null,
    previousPageToken: result.previousPageToken ?? null,
    currentPageToken: result.currentPageToken ?? null,
  };
}

export async function convertLead(
  args: ConvertLeadInput,
): Promise<ConvertLeadOutput> {
  const ctx: AuraContext = { token: args.auraToken, context: args.auraContext };

  const params: Record<string, unknown> = {
    leadId: args.leadId,
    convertedStatus: args.convertedStatus,
    overwriteLeadSource: args.overwriteLeadSource ?? false,
    doNotCreateOpportunity: args.doNotCreateOpportunity ?? false,
    bypassAccountDedupeCheck: args.bypassAccountDedupeCheck ?? false,
    bypassContactDedupeCheck: args.bypassContactDedupeCheck ?? false,
    recordSaveParams: {
      bypassDedupeCheck: false,
    },
  };

  if (args.ownerId) {
    params.ownerId = args.ownerId;
  }

  // Aura uses "existingAccountId" to merge into an existing account.
  // "newAccountRecord" creates a new one. They are mutually exclusive.
  if (args.accountId) {
    params.existingAccountId = args.accountId;
  } else if (args.newAccountRecord) {
    params.newAccountRecord = {
      sobjectType: 'Account',
      Name: args.newAccountRecord.Name,
      IsPersonAccount: args.newAccountRecord.IsPersonAccount ?? false,
    };
  }

  // Same pattern for contacts.
  if (args.contactId) {
    params.existingContactId = args.contactId;
  } else if (args.newContactRecord) {
    params.newContactRecord = {
      sobjectType: 'Contact',
      Salutation: args.newContactRecord.Salutation ?? '',
      FirstName: args.newContactRecord.FirstName ?? '',
      LastName: args.newContactRecord.LastName,
    };
  }

  // Opportunity: merge into existing, create new, or skip entirely.
  if (!args.doNotCreateOpportunity) {
    if (args.newOpportunityRecord) {
      params.newOpportunityRecord = {
        sobjectType: 'Opportunity',
        Name: args.newOpportunityRecord.Name,
      };
    } else if (args.opportunityName) {
      params.newOpportunityRecord = {
        sobjectType: 'Opportunity',
        Name: args.opportunityName,
      };
    }
  }

  const raw = await auraAction(ctx, DESCRIPTORS.convertLeadServer, params);

  const result = raw as {
    accountId: string;
    contactId: string;
    opportunityId: string | null;
    isPersonAccount: boolean;
    hasError: boolean;
  };

  return {
    accountId: result.accountId,
    contactId: result.contactId,
    opportunityId: result.opportunityId ?? null,
    isPersonAccount: result.isPersonAccount ?? false,
    hasError: result.hasError ?? false,
  };
}

export async function listConsentImports(
  args: ListConsentImportsInput,
): Promise<ListConsentImportsOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');

  const ctx = buildCtx(args);

  const params: Record<string, unknown> = {
    entityNameOrId: 'CommSubscriptionConsent',
    layoutType: args.layoutType ?? 'FULL',
    pageSize: args.pageSize ?? 25,
    currentPage: args.page ?? 0,
    getCount: true,
    useTimeout: false,
    enableRowActions: false,
  };

  if (args.sortBy) {
    params.sortBy = args.sortBy;
  }

  const raw = await auraAction(ctx, DESCRIPTORS.getItems, params);

  const result = raw as {
    result: Array<{ record: { Id: string; [key: string]: unknown } }>;
    totalCount: number;
  };

  return {
    totalCount: result.totalCount,
    imports: result.result.map((item) => item.record),
  };
}

let subscriptionActionCounter = 0;

export async function listSubscriptions(
  args: ListSubscriptionsInput,
): Promise<ListSubscriptionsOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');

  const ctx = buildCtx(args);

  const pageSize = args.pageSize ?? 50;
  const offset =
    args.offset ??
    (args.page != null && args.page > 0 ? args.page * pageSize : 0);

  const params: Record<string, unknown> = {
    filterName: args.filterName ?? '__Recent',
    entityName: 'CommSubscription',
    pageSize,
    layoutType: args.layoutType ?? 'LIST',
    sortBy: args.sortBy ?? null,
    getCount: args.getCount ?? true,
    enableRowActions: args.enableRowActions ?? false,
    offset,
  };

  if (args.useTimeout != null) {
    params.useTimeout = args.useTimeout;
  }

  const action: AuraAction = {
    id: `${++subscriptionActionCounter};a`,
    descriptor: DESCRIPTORS.getListViewItems,
    callingDescriptor: 'UNKNOWN',
    params,
  };

  const response = await auraRequest(ctx, [action]);
  const result = response.actions[0];

  if (!result || result.state !== 'SUCCESS') {
    const msg =
      result?.error?.[0]?.message ?? `Aura action state: ${result?.state}`;
    throw new UpstreamError(`Salesforce error: ${msg}`);
  }

  const rv = result.returnValue as {
    totalCount?: number;
    offset: number;
    hasMoreData: boolean;
    recordIdActionsList?: Array<{ recordId: string }>;
  };

  // Extract records from context.$Record GVP
  const gvps = (
    response as unknown as {
      context?: {
        globalValueProviders?: Array<{
          type: string;
          values?: {
            records?: Record<
              string,
              Record<
                string,
                {
                  record?: {
                    fields?: Record<
                      string,
                      { displayValue: string | null; value: unknown }
                    >;
                    id?: string;
                  };
                }
              >
            >;
          };
        }>;
      };
    }
  ).context?.globalValueProviders;

  let recordMap: Record<
    string,
    Record<
      string,
      {
        record?: {
          fields?: Record<
            string,
            { displayValue: string | null; value: unknown }
          >;
          id?: string;
        };
      }
    >
  > = {};
  if (gvps) {
    for (const gvp of gvps) {
      if (gvp.type === '$Record' && gvp.values?.records) {
        recordMap = gvp.values.records;
        break;
      }
    }
  }

  // Build subscription records in order of recordIdActionsList
  const ids = (rv.recordIdActionsList ?? []).map((r) => r.recordId);
  const subscriptions: Array<{ Id: string; [k: string]: unknown }> = [];

  for (const id of ids) {
    const entry = recordMap[id];
    const recData = entry?.CommSubscription?.record;
    if (recData?.fields) {
      const flat: Record<string, unknown> = { Id: recData.id ?? id };
      for (const [key, field] of Object.entries(recData.fields)) {
        flat[key] = field.value;
      }
      subscriptions.push(flat as { Id: string; [k: string]: unknown });
    } else {
      subscriptions.push({ Id: id });
    }
  }

  return {
    totalCount: rv.totalCount ?? subscriptions.length,
    subscriptions,
    hasMoreData: rv.hasMoreData,
    offset: rv.offset ?? offset,
  };
}

/**
 * Get a single segment record by ID.
 */
export async function getSegment(
  args: GetSegmentInput,
): Promise<GetSegmentOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.recordId, 'recordId');

  const ctx = buildCtx(args);

  // Path 1: getRecordWithFields, when explicit fields or optionalFields are
  // specified. Returns exactly the requested fields (no layout expansion).
  if (args.fields || args.optionalFields) {
    const raw = await auraAction(ctx, DESCRIPTORS.getRecordWithFields, {
      recordId: args.recordId,
      ...(args.fields ? { fields: args.fields } : {}),
      ...(args.optionalFields ? { optionalFields: args.optionalFields } : {}),
    });

    const result = raw as RecordUiResult & {
      onLoadErrorMessage?: string;
      childRelationships?: Record<string, unknown>;
    };

    if (result.onLoadErrorMessage || !result.id) {
      throw new NotFound(
        `getSegment: record not found for ${args.recordId}. ${result.onLoadErrorMessage ?? ''}`.trim(),
      );
    }

    if (result.apiName !== 'MarketSegment') {
      throw new ContractDrift(
        `getSegment: Record ${args.recordId} is a ${result.apiName}, not a MarketSegment. Provide a valid Segment ID.`,
      );
    }

    const record = flattenRecordUiFields(result);
    if (
      result.childRelationships &&
      Object.keys(result.childRelationships).length > 0
    ) {
      record.childRelationships = result.childRelationships;
    }
    return record as GetSegmentOutput;
  }

  // Path 2: getRecordWithLayouts, when layoutTypes is specified. Returns
  // fields based on layout configuration. Supports childRelationships and
  // pageSize for inline child record pagination.
  if (args.layoutTypes) {
    const layoutParams: Record<string, unknown> = {
      recordId: args.recordId,
      layoutTypes: args.layoutTypes,
      modes: args.modes ?? ['View'],
    };
    if (args.optionalFields) {
      layoutParams.optionalFields = args.optionalFields;
    }
    if (args.childRelationships) {
      layoutParams.childRelationships = args.childRelationships;
    }
    if (args.pageSize !== undefined) {
      layoutParams.pageSize = args.pageSize;
    }

    const raw = await auraAction(
      ctx,
      DESCRIPTORS.getRecordWithLayouts,
      layoutParams,
    );

    const result = raw as RecordUiResult & {
      onLoadErrorMessage?: string;
      childRelationships?: Record<string, unknown>;
    };

    if (result.onLoadErrorMessage || !result.id) {
      throw new NotFound(
        `getSegment: record not found for ${args.recordId}. ${result.onLoadErrorMessage ?? ''}`.trim(),
      );
    }

    if (result.apiName !== 'MarketSegment') {
      throw new ContractDrift(
        `getSegment: Record ${args.recordId} is a ${result.apiName}, not a MarketSegment. Provide a valid Segment ID.`,
      );
    }

    const record = flattenRecordUiFields(result);
    if (
      result.childRelationships &&
      Object.keys(result.childRelationships).length > 0
    ) {
      record.childRelationships = result.childRelationships;
    }
    return record as GetSegmentOutput;
  }

  // Path 3: DetailController, default path when no explicit fields or
  // layoutTypes are specified. Uses layoutType (singular) and mode.
  const params: Record<string, unknown> = {
    recordId: args.recordId,
    layoutType: args.layoutType ?? 'FULL',
    mode: args.mode ?? 'VIEW',
  };

  if (args.recordTypeId !== undefined) {
    params.recordTypeId = args.recordTypeId;
  }
  if (args.updateMru !== undefined) {
    params.updateMru = args.updateMru;
  }
  if (args.defaultFieldValues !== undefined) {
    params.defaultFieldValues = args.defaultFieldValues;
  }

  const raw = await auraAction(ctx, DESCRIPTORS.getRecord, params);

  const result = raw as GetRecordResult & { onLoadErrorMessage?: string };

  if (result.onLoadErrorMessage || !result.record) {
    throw new NotFound(
      `getSegment: record not found for ${args.recordId}. ${result.onLoadErrorMessage ?? ''}`.trim(),
    );
  }

  const sobjectType = result.record.sobjectType as string | undefined;
  if (sobjectType && sobjectType !== 'MarketSegment') {
    throw new ContractDrift(
      `getSegment: Record ${args.recordId} is a ${sobjectType}, not a MarketSegment. Provide a valid Segment ID.`,
    );
  }

  return result.record;
}

// ---------------------------------------------------------------------------
// Create Segment
// ---------------------------------------------------------------------------

export async function createSegment(
  args: CreateSegmentInput,
): Promise<CreateSegmentOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.name, 'name');
  validateString(args.segmentOnId, 'segmentOnId');

  const ctx = buildCtx(args);

  const fields: Record<string, unknown> = {
    Name: args.name,
    SegmentOnId: args.segmentOnId,
    IsSeedSegment: args.isSeedSegment ?? false,
  };

  if (args.description !== undefined) {
    fields.Description = args.description;
  }
  if (args.publishType !== undefined) {
    fields.PublishType = args.publishType;
  }
  if (args.publishScheduleInterval !== undefined) {
    fields.PublishScheduleInterval = args.publishScheduleInterval;
  }
  if (args.publishScheduleStartDateTime !== undefined) {
    fields.PublishScheduleStartDateTime = args.publishScheduleStartDateTime;
  }
  if (args.publishScheduleEndDate !== undefined) {
    fields.PublishScheduleEndDate = args.publishScheduleEndDate;
  }
  if (args.dataSpaceId !== undefined) {
    fields.DataSpaceId = args.dataSpaceId;
  }
  if (args.dataGraphId !== undefined) {
    fields.DataGraphId = args.dataGraphId;
  }
  if (args.marketSegmentDefinitionId !== undefined) {
    fields.MarketSegmentDefinitionId = args.marketSegmentDefinitionId;
  }
  if (args.lookbackPeriod !== undefined) {
    fields.LookbackPeriod = args.lookbackPeriod;
  }
  if (args.includeCriteria !== undefined) {
    fields.IncludeCriteria = args.includeCriteria;
  }
  if (args.excludeCriteria !== undefined) {
    fields.ExcludeCriteria = args.excludeCriteria;
  }

  const raw = await auraAction(ctx, DESCRIPTORS.createRecord, {
    recordInput: {
      apiName: 'MarketSegment',
      fields,
    },
  });

  const result = raw as RecordUiResult;

  return {
    id: result.id,
    record: flattenRecordUiFields(result) as {
      Id: string;
      [k: string]: unknown;
    },
  };
}

// ---------------------------------------------------------------------------
// Update Segment
// ---------------------------------------------------------------------------

export async function updateSegment(
  args: UpdateSegmentInput,
): Promise<UpdateSegmentOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.segmentId, 'segmentId');

  if (!args.fields || Object.keys(args.fields).length === 0) {
    throw new Validation(
      'fields is required and must contain at least one property to update.',
    );
  }

  const ctx = buildCtx(args);

  const params: Record<string, unknown> = {
    recordId: args.segmentId,
    recordInput: {
      fields: { ...args.fields },
    },
  };

  if (args.ifUnmodifiedSince) {
    params.clientOptions = { ifUnmodifiedSince: args.ifUnmodifiedSince };
  }

  const raw = await auraAction(ctx, DESCRIPTORS.updateRecord, params);

  const result = raw as RecordUiResult;

  return {
    id: result.id,
    record: flattenRecordUiFields(result) as {
      Id: string;
      [k: string]: unknown;
    },
  };
}

// ---------------------------------------------------------------------------
// Delete Segment
// ---------------------------------------------------------------------------

export async function deleteSegment(
  args: DeleteSegmentInput,
): Promise<DeleteSegmentOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.segmentId, 'segmentId');

  const ctx = buildCtx(args);

  await auraAction(ctx, DESCRIPTORS.deleteRecord, {
    recordId: args.segmentId,
  });

  return {
    deleted: true,
    recordId: args.segmentId,
  };
}
