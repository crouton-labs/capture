/**
 * Salesforce Search & Record Lookup Operations
 *
 * Cross-object search, scoped record search, generic record listing,
 * and single-record retrieval via Aura framework API.
 *
 * Raw SOQL is not directly supported through the Aura action framework.
 * Use listRecords for entity-scoped record listing and searchRecords
 * for cross-object or scoped keyword search.
 */

import { Validation, NotFound } from '@vallum/_runtime';
import { auraAction, DESCRIPTORS, validateString } from '../aura';
import type { AuraContext } from '../aura';
import type { ExecuteGraphQLInput, ExecuteGraphQLOutput } from '../schemas';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

interface AuraCredentials {
  auraToken: string;
  auraContext: string;
}

interface SObjectRecord {
  Id: string;
  [key: string]: unknown;
}

interface ScopeMap {
  name: string;
  label: string;
  labelPlural: string;
  [key: string]: unknown;
}

interface RecordSuggestion {
  record: SObjectRecord;
  scopeMap: ScopeMap;
}

interface SuggestionsAnswer {
  type: string;
  data: {
    records?: RecordSuggestion[];
    suggestions?: Array<{ query: string }>;
    listViews?: unknown[];
  };
}

interface SuggestionsResponse {
  answers: SuggestionsAnswer[];
  [key: string]: unknown;
}

interface SearchResultGroup {
  entityType: string;
  records: SObjectRecord[];
}

interface SearchResponse {
  groups: SearchResultGroup[];
  querySuggestions?: string[];
  listViewSuggestions?: Array<{
    id: string;
    name: string;
    entityType: string;
  }>;
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

interface RecordUiResult {
  id: string;
  apiName: string;
  fields: Record<string, { displayValue: string | null; value: unknown }>;
  childRelationships?: Record<string, unknown>;
  onLoadErrorMessage?: string;
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
// Global Search
// ---------------------------------------------------------------------------

/**
 * Search across all Salesforce objects using the autocomplete/suggestions endpoint.
 * Returns results grouped by object type (Account, Contact, Lead, etc.).
 */
export async function globalSearch(
  args: AuraCredentials & {
    query: string;
    entityName?: string;
    limit?: number;
    maxQueries?: number;
    maxListViews?: number;
  },
): Promise<SearchResponse> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.query, 'query');

  if (args.query.length < 2) {
    throw new Validation('Search query must be at least 2 characters.');
  }

  if (
    args.limit !== undefined &&
    (typeof args.limit !== 'number' || args.limit < 1)
  ) {
    throw new Validation('limit must be a positive number.');
  }

  const ctx = buildCtx(args);

  const raw = await auraAction(ctx, DESCRIPTORS.getSuggestions, {
    term: args.query,
    entityName: args.entityName ?? null,
    maxRecords: args.limit ?? 200,
    maxQueries: args.maxQueries ?? 20,
    maxTips: 0,
    maxListViews: args.maxListViews ?? 20,
    context: { FILTERS: {} },
    configurationName: 'GLOBAL_SEARCH_BAR',
  });

  const suggestionsResponse = raw as SuggestionsResponse;

  // Extract record suggestions and group by entity type
  const recordAnswer = suggestionsResponse.answers.find(
    (a) => a.type === 'RECORD_SUGGESTIONS',
  );

  const result: SearchResponse = { groups: [] };

  if (recordAnswer?.data?.records) {
    // Group records by sObject type
    const byType = new Map<string, SObjectRecord[]>();
    for (const item of recordAnswer.data.records) {
      const entityType = item.scopeMap.name;
      const existing = byType.get(entityType);
      if (existing) {
        existing.push(item.record);
      } else {
        byType.set(entityType, [item.record]);
      }
    }

    for (const [entityType, records] of Array.from(byType.entries())) {
      result.groups.push({ entityType, records });
    }
  }

  // Extract query suggestions
  const queryAnswer = suggestionsResponse.answers.find(
    (a) => a.type === 'QUERY_SUGGESTIONS',
  );
  if (queryAnswer?.data?.suggestions && queryAnswer.data.suggestions.length) {
    result.querySuggestions = queryAnswer.data.suggestions.map((s) => s.query);
  }

  // Extract list view suggestions
  const listViewAnswer = suggestionsResponse.answers.find(
    (a) => a.type === 'LIST_VIEW_SUGGESTIONS',
  );
  if (listViewAnswer?.data?.listViews && listViewAnswer.data.listViews.length) {
    result.listViewSuggestions = (
      listViewAnswer.data.listViews as Array<{
        id: string;
        name: string;
        scopeMap: { name: string };
      }>
    ).map((lv) => ({
      id: lv.id,
      name: lv.name,
      entityType: lv.scopeMap.name,
    }));
  }

  return result;
}

// ---------------------------------------------------------------------------
// Search Records (scoped by entity type)
// ---------------------------------------------------------------------------

/**
 * Search records within a specific sObject type using getSuggestions with entityName.
 * Works for any standard or custom sObject (Account, Contact, CustomObj__c, etc.).
 */
export async function searchRecords(
  args: AuraCredentials & {
    entityType: string;
    query: string;
    limit?: number;
    maxQueries?: number;
    maxTips?: number;
    maxListViews?: number;
    configurationName?: string;
  },
): Promise<SObjectRecord[]> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.entityType, 'entityType');
  validateString(args.query, 'query');

  if (args.query.length < 2) {
    throw new Validation('Search query must be at least 2 characters.');
  }

  if (
    args.limit !== undefined &&
    (typeof args.limit !== 'number' || args.limit < 1)
  ) {
    throw new Validation('limit must be a positive number.');
  }

  const ctx = buildCtx(args);

  const raw = await auraAction(ctx, DESCRIPTORS.getSuggestions, {
    term: args.query,
    entityName: args.entityType,
    maxRecords: args.limit ?? 200,
    maxQueries: args.maxQueries ?? 20,
    maxTips: args.maxTips ?? 20,
    maxListViews: args.maxListViews ?? 20,
    context: { FILTERS: {} },
    configurationName: args.configurationName ?? 'GLOBAL_SEARCH_BAR',
  });

  const suggestionsResponse = raw as SuggestionsResponse;

  // Extract record suggestions
  const recordAnswer = suggestionsResponse.answers.find(
    (a) => a.type === 'RECORD_SUGGESTIONS',
  );

  if (!recordAnswer?.data?.records) {
    return [];
  }

  const records = recordAnswer.data.records.map((item) => item.record);

  // Enforce limit client-side; the server's maxRecords hint is unreliable
  const limit = args.limit ?? 200;
  return records.slice(0, limit);
}

// ---------------------------------------------------------------------------
// List Records (generic entity listing)
// ---------------------------------------------------------------------------

function flattenListUiRecord(rec: ListUiRecord): SObjectRecord {
  const flat: Record<string, unknown> = { Id: rec.id };
  for (const [key, field] of Object.entries(rec.fields)) {
    flat[key] = flattenAuraValue(field.value);
  }
  return flat as SObjectRecord;
}

/**
 * List records for any sObject type using postListRecordsByName.
 * Works for any standard or custom sObject (Account, Contact, Task, CustomObj__c, etc.).
 */
export async function listRecords(
  args: AuraCredentials & {
    entityType: string;
    listViewApiName?: string;
    pageSize?: number;
    page?: number;
    pageToken?: string;
    sortBy?: string;
    searchTerm?: string;
    where?: string;
    fields?: string[];
    optionalFields?: string[];
  },
): Promise<{
  count: number;
  records: SObjectRecord[];
  nextPageToken: string | null;
  previousPageToken: string | null;
  currentPageToken: string | null;
}> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.entityType, 'entityType');

  const ctx = buildCtx(args);

  const pageSize = args.pageSize ?? 25;
  const listRecordsQuery: Record<string, unknown> = {
    fields: args.fields ?? [],
    optionalFields: args.optionalFields ?? [],
    pageSize,
    sortBy: args.sortBy ? [args.sortBy] : [],
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
    objectApiName: args.entityType,
    listViewApiName: args.listViewApiName ?? '__Recent',
    listRecordsQuery,
  });

  const result = raw as ListUiResult;

  return {
    count: result.count,
    records: result.records.map(flattenListUiRecord),
    nextPageToken: result.nextPageToken ?? null,
    previousPageToken: result.previousPageToken ?? null,
    currentPageToken: result.currentPageToken ?? null,
  };
}

// ---------------------------------------------------------------------------
// Get Record (generic single-record retrieval)
// ---------------------------------------------------------------------------

/**
 * Retrieve a single record by ID for any sObject type.
 *
 * Routing:
 * 1. fields or childRelationships specified → RecordUiController/getRecordWithFields
 * 2. optionalFields without fields → RecordUiController/getRecordWithLayouts
 *    (returns all layout fields + optional extras in one call)
 * 3. Otherwise → DetailController/getRecord with layoutType/mode
 */
export async function getRecord(
  args: AuraCredentials & {
    recordId?: string;
    layoutType?: 'FULL' | 'COMPACT';
    mode?: 'VIEW' | 'EDIT' | 'CREATE' | 'CLONE';
    fields?: string[];
    optionalFields?: string[];
    childRelationships?: string[];
    pageSize?: number;
    pageToken?: string;
    defaultFieldValues?: Record<string, unknown>;
    entityApiNameOrKeyPrefix?: string;
  },
): Promise<SObjectRecord> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  if (!args.recordId && !args.entityApiNameOrKeyPrefix) {
    throw new Validation(
      'getRecord: either recordId or entityApiNameOrKeyPrefix is required',
    );
  }

  const ctx = buildCtx(args);

  // When explicit fields are specified, use
  // RecordUiController/getRecordWithFields for precise field selection.
  // childRelationships only works with this path (requires fields param).
  if (args.fields) {
    const raw = await auraAction(ctx, DESCRIPTORS.getRecordWithFields, {
      recordId: args.recordId,
      ...(args.fields ? { fields: args.fields } : {}),
      ...(args.optionalFields ? { optionalFields: args.optionalFields } : {}),
      ...(args.childRelationships
        ? { childRelationships: args.childRelationships }
        : {}),
      ...(args.pageSize != null ? { pageSize: args.pageSize } : {}),
      ...(args.pageToken ? { pageToken: args.pageToken } : {}),
    });

    const result = raw as RecordUiResult;

    if (result.onLoadErrorMessage || !result.id) {
      throw new NotFound(
        `getRecord: record not found for ${args.recordId}. ${result.onLoadErrorMessage ?? ''}`.trim(),
      );
    }

    const record = flattenRecordUiFields(result);
    if (
      result.childRelationships &&
      Object.keys(result.childRelationships).length > 0
    ) {
      record.childRelationships = result.childRelationships;
    }
    return record as SObjectRecord;
  }

  // When optionalFields is specified without explicit fields, use
  // RecordUiController/getRecordWithLayouts which returns all layout-driven
  // fields plus the optional extras in one call. getRecordWithFields would
  // only return the optionalFields, missing the base layout fields.
  if (args.optionalFields) {
    const layoutMap: Record<string, string> = {
      FULL: 'Full',
      COMPACT: 'Compact',
    };
    const modeMap: Record<string, string> = {
      VIEW: 'View',
      EDIT: 'Edit',
      CREATE: 'Create',
      CLONE: 'Clone',
    };
    const raw = await auraAction(ctx, DESCRIPTORS.getRecordWithLayouts, {
      recordId: args.recordId,
      layoutTypes: [layoutMap[args.layoutType ?? 'FULL']],
      modes: [modeMap[args.mode ?? 'VIEW']],
      optionalFields: args.optionalFields,
    });

    const result = raw as RecordUiResult;

    if (result.onLoadErrorMessage || !result.id) {
      throw new NotFound(
        `getRecord: record not found for ${args.recordId}. ${result.onLoadErrorMessage ?? ''}`.trim(),
      );
    }

    return flattenRecordUiFields(result) as SObjectRecord;
  }

  const detailParams: Record<string, unknown> = {
    layoutType: args.layoutType ?? 'FULL',
    mode: args.mode ?? 'VIEW',
  };
  if (args.recordId) detailParams.recordId = args.recordId;
  if (args.entityApiNameOrKeyPrefix) {
    detailParams.entityApiNameOrKeyPrefix = args.entityApiNameOrKeyPrefix;
  }
  if (args.defaultFieldValues !== undefined) {
    detailParams.defaultFieldValues = args.defaultFieldValues;
  }

  const raw = await auraAction(ctx, DESCRIPTORS.getRecord, detailParams);

  const result = raw as { record?: SObjectRecord; onLoadErrorMessage?: string };

  if (result.onLoadErrorMessage || !result.record) {
    throw new NotFound(
      `getRecord: record not found for ${args.recordId ?? args.entityApiNameOrKeyPrefix}. ${result.onLoadErrorMessage ?? ''}`.trim(),
    );
  }

  return result.record;
}

// ---------------------------------------------------------------------------
// GraphQL (Salesforce GraphQL API via Aura)
// ---------------------------------------------------------------------------

/**
 * Execute a GraphQL query against Salesforce via the RecordUiController.
 * Returns a standard GraphQL response with data, errors, and extensions.
 */
export async function executeGraphQL(
  args: ExecuteGraphQLInput,
): Promise<ExecuteGraphQLOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.query, 'query');

  const ctx = buildCtx(args);

  const queryInput: Record<string, unknown> = {
    query: args.query,
    variables: args.variables ?? {},
  };
  if (args.operationName) queryInput.operationName = args.operationName;
  if (args.extensions) queryInput.extensions = args.extensions;

  const result = await auraAction(
    ctx,
    'aura://RecordUiController/ACTION$executeGraphQL',
    { queryInput },
  );

  return result as ExecuteGraphQLOutput;
}
