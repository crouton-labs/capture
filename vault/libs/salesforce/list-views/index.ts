/**
 * Salesforce List View Operations
 *
 * Full CRUD for Salesforce list views via Aura framework API.
 * List views are saved record filter configurations for any sObject type.
 */

import { Validation } from '@vallum/_runtime';
import { auraAction, DESCRIPTORS, validateString } from '../aura';
import type { AuraContext } from '../aura';
import type {
  ListListViewsInput,
  ListListViewsOutput,
  GetListViewInput,
  GetListViewOutput,
  GetListViewRecordsInput,
  GetListViewRecordsOutput,
  CreateListViewInput,
  CreateListViewOutput,
  UpdateListViewInput,
  UpdateListViewOutput,
  DeleteListViewInput,
  DeleteListViewOutput,
} from './schemas';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

interface AuraCredentials {
  auraToken: string;
  auraContext: string;
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

interface ListViewSummaryItem {
  id: string;
  apiName: string;
  label: string;
  listViewApiName?: string;
}

interface ListViewSummaryCollectionResult {
  count: number;
  currentPageToken: string | null;
  nextPageToken: string | null;
  lists: ListViewSummaryItem[];
}

interface ColumnInfo {
  fieldApiName: string;
  label: string;
  sortable: boolean;
}

interface FilterConditionInfo {
  fieldApiName: string;
  operator: string;
  value: string | null;
}

interface OrderByInfo {
  fieldApiName: string;
  isAscending: boolean;
}

interface ListInfoResult {
  // Direct fields (from getListInfoByName response)
  label: string;
  displayColumns: ColumnInfo[];
  filteredByInfo: FilterConditionInfo[];
  filterLogicString: string | null;
  orderedByInfo: OrderByInfo[];
  visibility: string;
  // listReference contains the identity
  listReference: {
    id: string | null;
    listViewApiName: string;
    objectApiName: string;
    type?: string;
  };
}

// ---------------------------------------------------------------------------
// Aura Descriptor Constants
// ---------------------------------------------------------------------------

const LIST_VIEW_DESCRIPTORS = {
  getListInfosByObjectName:
    'aura://ListUiController/ACTION$getListInfosByObjectName',
  getListInfoByName: 'aura://ListUiController/ACTION$getListInfoByName',
  createListInfo: 'aura://ListUiController/ACTION$createListInfo',
  updateListInfoByApiName:
    'aura://ListUiController/ACTION$updateListInfoByApiName',
  deleteListInfo: 'aura://ListUiController/ACTION$deleteListInfo',
} as const;

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

function flattenListUiRecord(
  rec: ListUiRecord,
): Record<string, unknown> & { Id: string } {
  const flat: Record<string, unknown> & { Id: string } = { Id: rec.id };
  for (const [key, field] of Object.entries(rec.fields)) {
    flat[key] = flattenAuraValue(field.value);
  }
  return flat;
}

function normalizeListInfo(raw: ListInfoResult): GetListViewOutput {
  const ref = raw.listReference;
  return {
    id: ref?.id ?? '',
    apiName: ref?.listViewApiName ?? '',
    label: raw.label,
    objectApiName: ref?.objectApiName ?? '',
    columns: (raw.displayColumns ?? []).map((col) => ({
      fieldApiName: col.fieldApiName,
      label: col.label,
      sortable: col.sortable,
    })),
    filteredByInfo: (raw.filteredByInfo ?? []).map((f) => ({
      fieldApiName: f.fieldApiName,
      operator: f.operator,
      value: f.value ?? null,
    })),
    filterLogic: raw.filterLogicString ?? null,
    orderedByInfo: (raw.orderedByInfo ?? []).map((o) => ({
      fieldApiName: o.fieldApiName,
      isAscending: o.isAscending,
    })),
    visibility: raw.visibility ?? 'Private',
  };
}

// ---------------------------------------------------------------------------
// listListViews
// ---------------------------------------------------------------------------

export async function listListViews(
  args: ListListViewsInput,
): Promise<ListListViewsOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.objectApiName, 'objectApiName');

  const ctx = buildCtx(args);

  const params: Record<string, unknown> = {
    objectApiName: args.objectApiName,
    pageSize: args.pageSize ?? 50,
  };

  if (args.pageToken) {
    params.pageToken = args.pageToken;
  }

  if (args.recentListsOnly) {
    params.recentListsOnly = true;
  }

  if (args.query) {
    params.q = args.query;
  }

  const raw = await auraAction(
    ctx,
    LIST_VIEW_DESCRIPTORS.getListInfosByObjectName,
    params,
  );

  const result = raw as ListViewSummaryCollectionResult;

  const listViews = (result.lists ?? []).map((lv) => ({
    id: lv.id,
    apiName: lv.apiName,
    label: lv.label,
    listViewApiName: lv.listViewApiName ?? lv.apiName,
  }));

  return {
    count: result.count ?? listViews.length,
    listViews,
    nextPageToken: result.nextPageToken ?? null,
    currentPageToken: result.currentPageToken ?? null,
  };
}

// ---------------------------------------------------------------------------
// getListView
// ---------------------------------------------------------------------------

export async function getListView(
  args: GetListViewInput,
): Promise<GetListViewOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.objectApiName, 'objectApiName');
  validateString(args.listViewApiName, 'listViewApiName');

  const ctx = buildCtx(args);

  const raw = await auraAction(ctx, LIST_VIEW_DESCRIPTORS.getListInfoByName, {
    objectApiName: args.objectApiName,
    listViewApiName: args.listViewApiName,
  });

  return normalizeListInfo(raw as ListInfoResult);
}

// ---------------------------------------------------------------------------
// getListViewRecords
// ---------------------------------------------------------------------------

export async function getListViewRecords(
  args: GetListViewRecordsInput,
): Promise<GetListViewRecordsOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.objectApiName, 'objectApiName');
  validateString(args.listViewApiName, 'listViewApiName');

  const ctx = buildCtx(args);

  const pageSize = args.pageSize ?? 25;
  const listRecordsQuery: Record<string, unknown> = {
    fields: args.fields ?? [],
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
  }

  const raw = await auraAction(ctx, DESCRIPTORS.postListRecordsByName, {
    objectApiName: args.objectApiName,
    listViewApiName: args.listViewApiName,
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
// createListView
// ---------------------------------------------------------------------------

export async function createListView(
  args: CreateListViewInput,
): Promise<CreateListViewOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.objectApiName, 'objectApiName');
  validateString(args.label, 'label');
  validateString(args.listViewApiName, 'listViewApiName');

  const ctx = buildCtx(args);

  const listInfoInput: Record<string, unknown> = {
    label: args.label,
    listViewApiName: args.listViewApiName,
    visibility: args.visibility ?? 'Private',
    includeDefaultAttributes: true,
  };

  if (args.filteredByInfo && args.filteredByInfo.length > 0) {
    listInfoInput.filteredByInfo = args.filteredByInfo.map((f) => ({
      fieldApiName: f.fieldApiName,
      operator: f.operator,
      value: f.value,
    }));
  }

  if (args.filterLogic) {
    listInfoInput.filterLogic = args.filterLogic;
  }

  if (args.orderedByInfo && args.orderedByInfo.length > 0) {
    listInfoInput.orderedByInfo = args.orderedByInfo.map((o) => ({
      fieldApiName: o.fieldApiName,
      isAscending: o.isAscending,
    }));
  }

  const raw = await auraAction(ctx, LIST_VIEW_DESCRIPTORS.createListInfo, {
    objectApiName: args.objectApiName,
    listInfoInput,
  });

  return normalizeListInfo(raw as ListInfoResult);
}

// ---------------------------------------------------------------------------
// updateListView
// ---------------------------------------------------------------------------

export async function updateListView(
  args: UpdateListViewInput,
): Promise<UpdateListViewOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.objectApiName, 'objectApiName');
  validateString(args.listViewApiName, 'listViewApiName');

  const hasUpdate =
    args.label !== undefined ||
    args.filteredByInfo !== undefined ||
    args.filterLogic !== undefined ||
    args.orderedByInfo !== undefined ||
    args.visibility !== undefined;

  if (!hasUpdate) {
    throw new Validation(
      'At least one field to update must be provided (label, filteredByInfo, filterLogic, orderedByInfo, or visibility).',
    );
  }

  const ctx = buildCtx(args);

  const listInfoInput: Record<string, unknown> = {};

  if (args.label !== undefined) {
    listInfoInput.label = args.label;
  }

  if (args.filteredByInfo !== undefined) {
    listInfoInput.filteredByInfo = args.filteredByInfo.map((f) => ({
      fieldApiName: f.fieldApiName,
      operator: f.operator,
      value: f.value,
    }));
  }

  if (args.filterLogic !== undefined) {
    listInfoInput.filterLogic = args.filterLogic;
  }

  if (args.orderedByInfo !== undefined) {
    listInfoInput.orderedByInfo = args.orderedByInfo.map((o) => ({
      fieldApiName: o.fieldApiName,
      isAscending: o.isAscending,
    }));
  }

  if (args.visibility !== undefined) {
    listInfoInput.visibility = args.visibility;
  }

  const raw = await auraAction(
    ctx,
    LIST_VIEW_DESCRIPTORS.updateListInfoByApiName,
    {
      objectApiName: args.objectApiName,
      listViewApiName: args.listViewApiName,
      listInfoInput,
    },
  );

  return normalizeListInfo(raw as ListInfoResult);
}

// ---------------------------------------------------------------------------
// deleteListView
// ---------------------------------------------------------------------------

export async function deleteListView(
  args: DeleteListViewInput,
): Promise<DeleteListViewOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.objectApiName, 'objectApiName');
  validateString(args.listViewApiName, 'listViewApiName');

  const ctx = buildCtx(args);

  await auraAction(ctx, LIST_VIEW_DESCRIPTORS.deleteListInfo, {
    objectApiName: args.objectApiName,
    listViewApiName: args.listViewApiName,
  });

  return {
    deleted: true,
    objectApiName: args.objectApiName,
    listViewApiName: args.listViewApiName,
  };
}
