/**
 * Salesforce Reports & Dashboards Operations
 *
 * Read-only listing of reports and dashboards via Aura framework API.
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

interface ReportRecord {
  Id: string;
  Name: string;
  [key: string]: unknown;
}

interface DashboardRecord {
  Id: string;
  Title: string;
  [key: string]: unknown;
}

interface SObjectRecord {
  Id: string;
  [key: string]: unknown;
}

interface GetRecordResult {
  record: SObjectRecord;
}

interface RecordUiResult {
  id: string;
  apiName: string;
  fields: Record<string, { displayValue: string | null; value: unknown }>;
}

interface FolderRecord {
  Id: string;
  Name: string;
  Type: string;
  [key: string]: unknown;
}

const WAVE_DESCRIPTOR =
  'serviceComponent://ui.insights.components.recordhome.WaveAssetRecordHomeController/ACTION$loadContent';

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
// List Reports
// ---------------------------------------------------------------------------

/**
 * List reports via FolderHomeController.
 * Supports filtering by view scope, folder, and sorting.
 */
export async function listReports(
  args: AuraCredentials & {
    pageSize?: number;
    page?: number;
    navScope?:
      | 'mru'
      | 'everything'
      | 'created'
      | 'mine'
      | 'organizationOwned'
      | 'favoriteItems'
      | 'userFolders'
      | 'userFoldersCreatedByMe'
      | 'userFoldersSharedWithMe';
    orderBy?: string;
    folderId?: string;
    searchTerm?: string;
  },
): Promise<{
  totalCount: number;
  reports: ReportRecord[];
}> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');

  if (
    args.pageSize !== undefined &&
    (typeof args.pageSize !== 'number' || args.pageSize < 1)
  ) {
    throw new Validation('pageSize must be a positive number.');
  }

  if (
    args.page !== undefined &&
    (typeof args.page !== 'number' || args.page < 1)
  ) {
    throw new Validation('page must be a positive number (1-indexed).');
  }

  const ctx = buildCtx(args);

  const params: Record<string, unknown> = {
    entityApiName: 'Report',
    navScope: args.navScope ?? 'everything',
    orderBy: args.orderBy ?? null,
    pageNum: args.page ?? 1,
    pageSize: args.pageSize ?? 20,
    listViewId: Date.now(),
    includeWritableFoldersOnly: false,
    userIsEntityCreator: false,
    targetRecordId: null,
    folderId: args.folderId ?? null,
    searchTerm: args.searchTerm ?? null,
  };

  const raw = await auraAction(ctx, DESCRIPTORS.getFolderRecords, params);

  const result = raw as { result: ReportRecord[]; totalCount: number };

  return {
    totalCount: result.totalCount,
    reports: result.result,
  };
}

// ---------------------------------------------------------------------------
// List Dashboards
// ---------------------------------------------------------------------------

/**
 * List dashboards using FolderHomeController.
 * Supports filtering by view scope, folder, and sorting.
 */
export async function listDashboards(
  args: AuraCredentials & {
    pageSize?: number;
    page?: number;
    navScope?:
      | 'mru'
      | 'everything'
      | 'created'
      | 'mine'
      | 'userFolders'
      | 'userFoldersSharedWithMe'
      | 'favoriteItems';
    orderBy?: string;
    folderId?: string;
  },
): Promise<{
  totalCount: number;
  dashboards: DashboardRecord[];
}> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');

  if (
    args.pageSize !== undefined &&
    (typeof args.pageSize !== 'number' || args.pageSize < 1)
  ) {
    throw new Validation('pageSize must be a positive number.');
  }

  if (
    args.page !== undefined &&
    (typeof args.page !== 'number' || args.page < 0)
  ) {
    throw new Validation('page must be a non-negative number.');
  }

  const ctx = buildCtx(args);

  const params: Record<string, unknown> = {
    entityApiName: 'Dashboard',
    navScope: args.navScope ?? 'everything',
    orderBy: args.orderBy ?? null,
    pageNum: (args.page ?? 0) + 1,
    pageSize: args.pageSize ?? 20,
    listViewId: Date.now(),
    includeWritableFoldersOnly: false,
    userIsEntityCreator: false,
    targetRecordId: null,
  };

  if (args.folderId) {
    params.folderId = args.folderId;
  }

  const raw = await auraAction(ctx, DESCRIPTORS.getFolderRecords, params);

  const result = raw as { result: DashboardRecord[]; totalCount: number };

  return {
    totalCount: result.totalCount,
    dashboards: result.result,
  };
}

// ---------------------------------------------------------------------------
// Get Report
// ---------------------------------------------------------------------------

// Default fields to request when none specified; covers the most useful report metadata.
const DEFAULT_REPORT_FIELDS = [
  'Report.Name',
  'Report.Description',
  'Report.DeveloperName',
  'Report.FolderName',
  'Report.Format',
  'Report.LastRunDate',
  'Report.OwnerId',
  'Report.CreatedById',
  'Report.CreatedDate',
  'Report.LastModifiedById',
  'Report.LastModifiedDate',
  'Report.LastViewedDate',
  'Report.LastReferencedDate',
];

/**
 * Get a single report record by ID.
 */
export async function getReport(
  args: AuraCredentials & {
    reportId: string;
    fields?: string[];
    optionalFields?: string[];
  },
): Promise<ReportRecord> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.reportId, 'reportId');

  const ctx = buildCtx(args);

  const requestParams: Record<string, unknown> = {
    recordId: args.reportId,
  };

  const hasFields = args.fields && args.fields.length > 0;
  const hasOptionalFields =
    args.optionalFields && args.optionalFields.length > 0;

  if (hasFields) {
    requestParams.fields = args.fields;
  }

  if (hasOptionalFields) {
    requestParams.optionalFields = args.optionalFields;
  } else if (!hasFields) {
    // No fields specified at all; use sensible defaults
    requestParams.optionalFields = DEFAULT_REPORT_FIELDS;
  }

  const raw = await auraAction(
    ctx,
    DESCRIPTORS.getRecordWithFields,
    requestParams,
  );

  const result = raw as RecordUiResult & { onLoadErrorMessage?: string };

  if (result.onLoadErrorMessage || !result.id) {
    throw new NotFound(
      `getReport: Report not found (${args.reportId}). ${result.onLoadErrorMessage ?? ''}`.trim(),
    );
  }

  return flattenRecordUiFields(result) as ReportRecord;
}

// ---------------------------------------------------------------------------
// Run Report
// ---------------------------------------------------------------------------

/**
 * Initialize a report asset in the Wave Analytics viewer.
 * Returns report configuration metadata (assetId, assetType, applied filters).
 */
export async function runReport(
  args: AuraCredentials & {
    reportId: string;
    dynamicFilters?: Record<
      string,
      {
        column: string;
        durationValue: string;
        startDate?: string | null;
        endDate?: string | null;
      }
    >;
    reportFilters?: string;
  },
): Promise<{
  assetId: string;
  assetType: string;
  dynamicFilters: Record<
    string,
    {
      column: string;
      durationValue: string;
      startDate?: string | null;
      endDate?: string | null;
    }
  >;
  reportFilters?: string;
}> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.reportId, 'reportId');

  const ctx = buildCtx(args);

  const params: Record<string, unknown> = {
    recordId: args.reportId,
    dynamicFilters: args.dynamicFilters ?? {},
  };

  if (args.reportFilters !== undefined) {
    params.reportFilters = args.reportFilters;
  }

  const result = await auraAction(ctx, WAVE_DESCRIPTOR, params);

  const typed = result as {
    assetId: string;
    assetType: string;
    dynamicFilters: Record<
      string,
      {
        column: string;
        durationValue: string;
        startDate?: string | null;
        endDate?: string | null;
      }
    >;
    reportFilters?: string;
  };

  if (!typed || typeof typed.assetId !== 'string') {
    throw new ContractDrift(
      `runReport: unexpected response from WaveAssetRecordHomeController for report ${args.reportId}`,
    );
  }

  return typed;
}

// ---------------------------------------------------------------------------
// Get Dashboard
// ---------------------------------------------------------------------------

/**
 * Get a single dashboard record by ID.
 */
export async function getDashboard(
  args: AuraCredentials & {
    dashboardId: string;
    layoutType?: 'FULL' | 'COMPACT';
  },
): Promise<DashboardRecord> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.dashboardId, 'dashboardId');

  const ctx = buildCtx(args);

  const raw = await auraAction(ctx, DESCRIPTORS.getRecord, {
    recordId: args.dashboardId,
    layoutType: args.layoutType ?? 'FULL',
    mode: 'VIEW',
  });

  const result = raw as GetRecordResult & { onLoadErrorMessage?: string };

  if (result.onLoadErrorMessage || !result.record) {
    throw new NotFound(
      `getDashboard: record not found for ${args.dashboardId}. ${result.onLoadErrorMessage ?? ''}`.trim(),
    );
  }

  return result.record as DashboardRecord;
}

// ---------------------------------------------------------------------------
// List Report Folders
// ---------------------------------------------------------------------------

/**
 * List report folders via FolderHomeController.getRecords (server-side filtered).
 */
const VALID_REPORT_FOLDER_SCOPES = new Set([
  'userFolders',
  'userFoldersCreatedByMe',
  'userFoldersSharedWithMe',
]);

export async function listReportFolders(
  args: AuraCredentials & {
    pageSize?: number;
    page?: number;
    scope?:
      | 'userFolders'
      | 'userFoldersCreatedByMe'
      | 'userFoldersSharedWithMe';
    orderBy?: string;
    folderId?: string;
    searchTerm?: string;
    includeWritableFoldersOnly?: boolean;
    userIsEntityCreator?: boolean;
  },
): Promise<{
  totalCount: number;
  folders: FolderRecord[];
}> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');

  if (args.scope !== undefined && !VALID_REPORT_FOLDER_SCOPES.has(args.scope)) {
    throw new Validation(
      `listReportFolders: Invalid scope "${args.scope}". Must be one of: ${[...VALID_REPORT_FOLDER_SCOPES].join(', ')}`,
    );
  }

  if (
    args.pageSize !== undefined &&
    (typeof args.pageSize !== 'number' || args.pageSize < 1)
  ) {
    throw new Validation('pageSize must be a positive number.');
  }

  if (
    args.page !== undefined &&
    (typeof args.page !== 'number' || args.page < 1)
  ) {
    throw new Validation('page must be a positive number (1-indexed).');
  }

  const ctx = buildCtx(args);

  const raw = await auraAction(ctx, DESCRIPTORS.getFolderRecords, {
    entityApiName: 'Report',
    navScope: args.scope ?? 'userFolders',
    orderBy: args.orderBy ?? null,
    pageNum: args.page ?? 1,
    pageSize: args.pageSize ?? 20,
    listViewId: Date.now(),
    includeWritableFoldersOnly: args.includeWritableFoldersOnly ?? false,
    userIsEntityCreator: args.userIsEntityCreator ?? false,
    targetRecordId: args.folderId ?? null,
    searchTerm: args.searchTerm ?? null,
  });

  const result = raw as { result?: FolderRecord[]; totalCount?: number } | null;

  return {
    totalCount: result?.totalCount ?? 0,
    folders: result?.result ?? [],
  };
}

// ---------------------------------------------------------------------------
// List Dashboard Folders
// ---------------------------------------------------------------------------

/**
 * List dashboard folders via FolderHomeController.getRecords (server-side filtered).
 */
const VALID_FOLDER_SCOPES = new Set([
  'userFolders',
  'userFoldersCreatedByMe',
  'userFoldersSharedWithMe',
]);

export async function listDashboardFolders(
  args: AuraCredentials & {
    pageSize?: number;
    page?: number;
    scope?:
      | 'userFolders'
      | 'userFoldersCreatedByMe'
      | 'userFoldersSharedWithMe';
    orderBy?: string;
    folderId?: string;
    includeWritableFoldersOnly?: boolean;
  },
): Promise<{
  totalCount: number;
  folders: FolderRecord[];
}> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');

  if (args.scope !== undefined && !VALID_FOLDER_SCOPES.has(args.scope)) {
    throw new Validation(
      `listDashboardFolders: Invalid scope "${args.scope}". Must be one of: ${[...VALID_FOLDER_SCOPES].join(', ')}`,
    );
  }

  if (
    args.pageSize !== undefined &&
    (typeof args.pageSize !== 'number' || args.pageSize < 1)
  ) {
    throw new Validation('pageSize must be a positive number.');
  }

  if (
    args.page !== undefined &&
    (typeof args.page !== 'number' || args.page < 1)
  ) {
    throw new Validation('page must be a positive number (1-indexed).');
  }

  const ctx = buildCtx(args);

  const raw = await auraAction(ctx, DESCRIPTORS.getFolderRecords, {
    entityApiName: 'Dashboard',
    navScope: args.scope ?? 'userFolders',
    orderBy: args.orderBy ?? null,
    pageNum: args.page ?? 1,
    pageSize: args.pageSize ?? 20,
    listViewId: Date.now(),
    includeWritableFoldersOnly: args.includeWritableFoldersOnly ?? false,
    userIsEntityCreator: false,
    targetRecordId: args.folderId ?? null,
  });

  const result = raw as { result?: FolderRecord[]; totalCount?: number } | null;

  return {
    totalCount: result?.totalCount ?? 0,
    folders: result?.result ?? [],
  };
}
