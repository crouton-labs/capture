/**
 * Data export operations
 */

import type { FileRef } from '../files/schemas';

declare const window: Window & {
  __vallum_files?: {
    write(
      name: string,
      data: string | ArrayBuffer | Uint8Array | Blob,
    ): Promise<FileRef>;
    read(identifier: string | { path: string }): Promise<ArrayBuffer>;
  };
};

import { ContractDrift, Validation, UpstreamError } from '@vallum/_runtime';
import {
  clayFetch,
  type TableResponse,
  type BulkFetchResponse,
  type RecordData,
} from './shared';
import type {
  ListActiveExportsInput,
  ListActiveExportsOutput,
  CreateExportInput,
  CreateExportOutput,
  DownloadCSVInput,
  DownloadCSVOutput,
  ImportCSVInput,
  ImportCSVOutput,
  ListSequencerIntegrationsInput,
  ListSequencerIntegrationsOutput,
  GetSequencerDynamicFieldsInput,
  GetSequencerDynamicFieldsOutput,
  AddExportToSequencerInput,
  AddExportToSequencerOutput,
} from './schemas';

interface AppAccountData {
  id: string;
  name: string;
  appAccountTypeId: string;
}

/**
 * Known sequencer/campaign integrations in Clay's catalog.
 * Maps appAccountTypeId → { provider name, actionPackageId, primary actions }.
 * Discovered via enrichment search + CDP exploration of Clay's "Send to Sequencer" UI.
 */
const SEQUENCER_INTEGRATIONS: Record<
  string,
  {
    provider: string;
    actionPackageId: string;
    actions: Array<{ actionKey: string; name: string }>;
  }
> = {
  'apollo-oauth': {
    provider: 'Apollo.io',
    actionPackageId: '778df10d-f68b-461a-8eb7-56047737f5eb',
    actions: [
      {
        actionKey: 'apollo-oauth-add-contact-to-sequence',
        name: 'Add contact to sequence',
      },
      {
        actionKey: 'apollo-oauth-update-status-in-sequence',
        name: 'Update contact status in sequence',
      },
    ],
  },
  hubspot: {
    provider: 'HubSpot',
    actionPackageId: 'a2584689-b965-4a25-847d-17b7abcddca3',
    actions: [
      {
        actionKey: 'hubspot-enroll-contact',
        name: 'Enroll a contact in a sequence',
      },
    ],
  },
  'smartlead-ai': {
    provider: 'Smartlead.ai',
    actionPackageId: '6e7ab2da-0d97-49ab-ba78-a6b2f3bf2029',
    actions: [
      { actionKey: 'add-lead-to-campaign', name: 'Add Lead to Campaign' },
      { actionKey: 'lookup-lead-in-campaign', name: 'Lookup Lead in Campaign' },
      { actionKey: 'update-lead', name: 'Update Lead in Campaign' },
      {
        actionKey: 'smartlead-remove-lead-from-campaign',
        name: 'Remove Lead from Campaign',
      },
      { actionKey: 'smartlead-lookup-lead-status', name: 'Lookup Lead Status' },
      { actionKey: 'update-lead-category', name: 'Update Lead Category' },
    ],
  },
  'clay-sequencer-smartlead': {
    provider: 'Clay Sequencer',
    actionPackageId: 'be4d37cc-fd0d-4ad3-a595-4d32147ae282',
    actions: [
      {
        actionKey: 'clay-sequencer-smartlead-lead-pause-campaign',
        name: 'Pause lead in campaign',
      },
      {
        actionKey: 'lead-reply-from-master-inbox-v2',
        name: 'Reply to lead in campaign',
      },
    ],
  },
  outreach: {
    provider: 'Outreach',
    actionPackageId: 'a4b885be-3778-4a54-a812-27f770a6c203',
    actions: [
      { actionKey: 'add-to-sequence', name: 'Add to Sequence' },
      { actionKey: 'create-prospect', name: 'Create Prospect' },
    ],
  },
  salesloft: {
    provider: 'Salesloft',
    actionPackageId: '2a60b279-7342-4168-85df-02d85cc7aaff',
    actions: [{ actionKey: 'add-to-cadence', name: 'Add Person to Cadence' }],
  },
  close: {
    provider: 'Close',
    actionPackageId: '5d6a4d03-dc3b-46ef-9a5e-edca81415976',
    actions: [
      { actionKey: 'subscribe-to-sequence', name: 'Subscribe to Sequence' },
    ],
  },
  salesforge: {
    provider: 'Salesforge',
    actionPackageId: '5d9b88be-63cb-4319-8bde-b9834fbc79f7',
    actions: [
      {
        actionKey: 'salesforge-add-lead-to-existing-sequence',
        name: 'Add lead to existing sequence',
      },
    ],
  },
  lemlist: {
    provider: 'Lemlist',
    actionPackageId: '0b5a7417-ebe5-4a7a-af0d-d982e226b8c2',
    actions: [
      {
        actionKey: 'lemlist-add-lead-to-campaign-v2',
        name: 'Add Lead to Campaign',
      },
      { actionKey: 'lookup-lead-in-campaign', name: 'Lookup Lead in Campaign' },
      { actionKey: 'update-lead', name: 'Update Lead in Campaign' },
    ],
  },
  heyreach: {
    provider: 'HeyReach',
    actionPackageId: '38c1e626-7785-4d36-a993-301bd302aebf',
    actions: [
      {
        actionKey: 'heyreach-add-lead-to-campaign',
        name: 'Add Lead to Campaign',
      },
    ],
  },
  instantly: {
    provider: 'Instantly',
    actionPackageId: '70cda03a-a576-4a6c-b3b3-55e241f828b5',
    actions: [
      {
        actionKey: 'instantly-v2-add-lead-to-campaign',
        name: 'Add Lead to Campaign',
      },
      { actionKey: 'instantly-v2-update-lead', name: 'Update Lead' },
    ],
  },
  emailbison: {
    provider: 'EmailBison',
    actionPackageId: 'e4f59f92-dfce-4fbf-8764-2601bf1e144f',
    actions: [
      {
        actionKey: 'emailbison-import-lead-to-campaign',
        name: 'Import lead(s) to campaign',
      },
      {
        actionKey: 'emailbison-create-or-update-lead',
        name: 'Create or update lead',
      },
    ],
  },
  'reply-io': {
    provider: 'Reply.io',
    actionPackageId: '4468392a-ee4f-4d69-9ef1-548c62ae965d',
    actions: [
      {
        actionKey: 'push-contact-to-campaign',
        name: 'Push Contact to Campaign',
      },
    ],
  },
  woodpecker: {
    provider: 'Woodpecker',
    actionPackageId: '3aaaf38f-83ce-4aa0-ae87-cdc722be8803',
    actions: [
      {
        actionKey: 'woodpecker-add-prospect-to-campaign',
        name: 'Add prospect to campaign',
      },
      {
        actionKey: 'woodpecker-update-prospect-in-campaign',
        name: 'Update prospect in campaign',
      },
    ],
  },
  groove: {
    provider: 'Groove',
    actionPackageId: '4f7c6d2e-9b3a-4185-a5d2-8f91c7e45b9d',
    actions: [{ actionKey: 'add-person-to-flow', name: 'Add person to flow' }],
  },
  gong: {
    provider: 'Gong',
    actionPackageId: '48aa0220-fa5b-43d8-a1a3-ffcbebfb713a',
    actions: [
      { actionKey: 'gong-add-prospect-to-flow', name: 'Add prospect to flow' },
    ],
  },
  activecampaign: {
    provider: 'ActiveCampaign',
    actionPackageId: '94445e51-05fb-48d7-9964-d500a7b369ca',
    actions: [
      {
        actionKey: 'activecampaign-add-to-automation',
        name: 'Add to automation',
      },
    ],
  },
  'la-growth-machine': {
    provider: 'La Growth Machine',
    actionPackageId: '3c16302a-a1ce-4d4c-b537-c8f46b94f8e5',
    actions: [
      {
        actionKey: 'la-growth-machine-create-lead',
        name: 'Create or update lead',
      },
    ],
  },
  'snov-io': {
    provider: 'Snov.io',
    actionPackageId: 'd8c220e0-401e-49ca-8c6b-37c7577baffd',
    actions: [
      { actionKey: 'snov-sequencer-add', name: 'Add prospect to list' },
    ],
  },
  sendspark: {
    provider: 'Sendspark',
    actionPackageId: '5859da2d-d2ea-48ec-ba97-2d744e87823b',
    actions: [
      {
        actionKey: 'sendspark-add-prospect-to-video-campaign-v2',
        name: 'Add Prospect to Video Campaign',
      },
    ],
  },
};

interface DynamicFieldOption {
  displayName: string;
  value: string;
}

interface DynamicFieldResult {
  parameterPath: string;
  dynamicData: DynamicFieldOption[];
  errors: unknown[];
}

interface EnrichmentFieldResponse {
  field: {
    id: string;
    name: string;
    settingsError?: Array<{ type: string; message: string }>;
  };
}

interface ExportJobResponse {
  id: string;
  workspaceId: number;
  tableId: string;
  viewId: string;
  userId: number;
  fileName: string;
  status: string;
  uploadedFilePath: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  totalRecordsInViewCount: number;
  recordsExportedCount: number;
  downloadUrl: string | null;
  settings: Record<string, unknown> | null;
  exportType: string;
}

/**
 * List all active exports for a workspace
 * GET /v3/exports/my-active-exports/{workspaceId}
 */
export async function listActiveExports(
  params: ListActiveExportsInput,
): Promise<ListActiveExportsOutput> {
  const { workspaceId } = params;

  if (!workspaceId) {
    throw new Validation('listActiveExports: workspaceId is required');
  }

  const data = await clayFetch<ExportJobResponse[]>(
    `/exports/my-active-exports/${workspaceId}`,
  );

  return {
    exports: (data ?? []).map((e) => ({
      id: e.id,
      workspaceId: e.workspaceId,
      tableId: e.tableId,
      viewId: e.viewId,
      userId: e.userId,
      fileName: e.fileName,
      status: e.status,
      uploadedFilePath: e.uploadedFilePath,
      expiresAt: e.expiresAt,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
      totalRecordsInViewCount: e.totalRecordsInViewCount,
      recordsExportedCount: e.recordsExportedCount,
      downloadUrl: e.downloadUrl,
      settings: e.settings,
      exportType: e.exportType,
    })),
  };
}

/**
 * Create an export job for a table or view
 * POST /v3/tables/{tableId}/export (full table)
 * POST /v3/tables/{tableId}/views/{viewId}/export (specific view)
 */
export async function createExport(
  params: CreateExportInput,
): Promise<CreateExportOutput> {
  const { tableId, viewId } = params;

  if (!tableId) {
    throw new Validation('createExport: tableId is required');
  }

  const path = viewId
    ? `/tables/${tableId}/views/${viewId}/export`
    : `/tables/${tableId}/export`;

  const data = await clayFetch<ExportJobResponse>(path, {
    method: 'POST',
    body: JSON.stringify({}),
  });

  return {
    id: data.id,
    workspaceId: data.workspaceId,
    tableId: data.tableId,
    viewId: data.viewId,
    userId: String(data.userId),
    fileName: data.fileName,
    status: data.status,
    uploadedFilePath: data.uploadedFilePath,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    totalRecordsInViewCount: data.totalRecordsInViewCount,
    recordsExportedCount: data.recordsExportedCount,
    downloadUrl: data.downloadUrl,
    settings: data.settings,
    exportType: data.exportType,
  };
}

/**
 * Download a table as CSV. Fetches all records, builds CSV, saves to device via files lib.
 */
export async function downloadCSV(
  params: DownloadCSVInput,
): Promise<DownloadCSVOutput> {
  const { tableId } = params;
  let { viewId } = params;

  if (!tableId) {
    throw new Validation('downloadCSV: tableId is required');
  }

  // Get table metadata (fields + default view)
  const tableData = await clayFetch<TableResponse>(`/tables/${tableId}`);
  const tableName = tableData.table.name;
  const fields = tableData.table.fields ?? [];
  if (!viewId) {
    viewId = tableData.table.firstViewId;
    if (!viewId) {
      throw new ContractDrift(
        `downloadCSV: table ${tableId} has no views. Provide a viewId explicitly.`,
      );
    }
  }

  // Build field name list from table fields
  const fieldNames: string[] = [];
  for (const f of fields) {
    fieldNames.push(f.name);
  }

  // Get all record IDs
  const idsResponse = await clayFetch<{ results: string[] }>(
    `/tables/${tableId}/views/${viewId}/records/ids`,
  );
  const recordIds = idsResponse.results;

  // Fetch records in batches
  const BATCH_SIZE = 300;
  const allRecords: RecordData[] = [];
  for (let i = 0; i < recordIds.length; i += BATCH_SIZE) {
    const batch = recordIds.slice(i, i + BATCH_SIZE);
    const data = await clayFetch<BulkFetchResponse>(
      `/tables/${tableId}/bulk-fetch-records`,
      {
        method: 'POST',
        body: JSON.stringify({
          recordIds: batch,
          includeExternalContentFieldIds: [],
        }),
      },
    );
    allRecords.push(...(data.results ?? []));
  }

  // Build CSV
  const headerRow = fieldNames
    .map((n) => `"${n.replace(/"/g, '""')}"`)
    .join(',');
  const dataRows = allRecords.map((record) => {
    return fieldNames
      .map((name) => {
        const fieldId = fields.find((f) => f.name === name)?.id;
        if (!fieldId) return '""';
        const cell = record.cells[fieldId];
        const value = cell?.value;
        if (value === null || value === undefined) return '""';
        const str =
          typeof value === 'object' ? JSON.stringify(value) : String(value);
        return `"${str.replace(/"/g, '""')}"`;
      })
      .join(',');
  });
  const csvContent = [headerRow, ...dataRows].join('\n');

  // Save to device via files lib
  const fileName = `${tableName}.csv`;

  let filePath: string | null = null;
  if (window.__vallum_files) {
    const fileRef = await window.__vallum_files.write(fileName, csvContent);
    filePath = fileRef.path;
  }

  return {
    fileName,
    recordsExportedCount: allRecords.length,
    filePath,
    content: csvContent,
  };
}

/**
 * List available sequencer/campaign integrations with connected app accounts.
 * Cross-references the known SEQUENCER_INTEGRATIONS catalog against the user's
 * connected app accounts. Only returns integrations the user has connected.
 * GET /workspaces/{id}/app-accounts
 */
export async function listSequencerIntegrations(
  params: ListSequencerIntegrationsInput,
): Promise<ListSequencerIntegrationsOutput> {
  const { workspaceId } = params;

  if (!workspaceId) {
    throw new Validation('listSequencerIntegrations: workspaceId is required');
  }

  const appAccountsData = await clayFetch<AppAccountData[]>(
    `/workspaces/${workspaceId}/app-accounts`,
  );
  const accounts = appAccountsData || [];

  const integrations: ListSequencerIntegrationsOutput['integrations'] = [];

  for (const [typeId, info] of Object.entries(SEQUENCER_INTEGRATIONS)) {
    const matchingAccounts = accounts.filter(
      (a) => a.appAccountTypeId === typeId,
    );
    if (matchingAccounts.length === 0) continue;

    for (const action of info.actions) {
      integrations.push({
        name: `${info.provider}: ${action.name}`,
        entityId: `${info.actionPackageId}/${action.actionKey}`,
        actionPackageId: info.actionPackageId,
        actionKey: action.actionKey,
        appAccounts: matchingAccounts.map((a) => ({
          id: a.id,
          name: a.name,
          type: a.appAccountTypeId,
        })),
      });
    }
  }

  return { integrations };
}

/**
 * Get dynamic field options (sequences, email accounts, users) for a sequencer integration.
 * POST /v3/actions/dynamicFields
 */
export async function getSequencerDynamicFields(
  params: GetSequencerDynamicFieldsInput,
): Promise<GetSequencerDynamicFieldsOutput> {
  const { actionPackageId, actionKey, authAccountId, tableId, parameterPaths } =
    params;

  if (!parameterPaths || parameterPaths.length === 0) {
    throw new Validation(
      'getSequencerDynamicFields: parameterPaths must be non-empty',
    );
  }

  const dynamicRequests = parameterPaths.map((path) => ({
    actionPackageId,
    actionKey,
    authAccountId,
    parameterPath: path,
    type: 'select',
    inputs: {},
    tableId,
  }));

  const data = await clayFetch<DynamicFieldResult[]>('/actions/dynamicFields', {
    method: 'POST',
    body: JSON.stringify({ dynamicRequests }),
  });

  if (!Array.isArray(data)) {
    throw new ContractDrift('getSequencerDynamicFields: unexpected response format');
  }

  return {
    fields: data.map((r) => ({
      parameterPath: r.parameterPath,
      options: (r.dynamicData || []).map((o) => ({
        label: o.displayName,
        value: o.value,
      })),
    })),
  };
}

/**
 * Add a sequencer export column to a table.
 * POST /tables/{tableId}/fields with type "action"
 */
export async function addExportToSequencer(
  params: AddExportToSequencerInput,
): Promise<AddExportToSequencerOutput> {
  const {
    tableId,
    actionPackageId,
    actionKey,
    authAccountId,
    inputMappings,
    columnName,
  } = params;

  if (!tableId) {
    throw new Validation('addExportToSequencer: tableId is required');
  }
  if (!actionPackageId) {
    throw new Validation('addExportToSequencer: actionPackageId is required');
  }
  if (!actionKey) {
    throw new Validation('addExportToSequencer: actionKey is required');
  }
  if (!authAccountId) {
    throw new Validation('addExportToSequencer: authAccountId is required');
  }

  const inputsBinding = inputMappings.map((m) => ({
    name: m.inputName,
    formulaText: m.isFieldReference ? `{{${m.value}}}` : `"${m.value}"`,
  }));

  const body = {
    type: 'action',
    name:
      columnName ||
      actionKey.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    typeSettings: {
      dataTypeSettings: { type: 'json' },
      actionKey,
      actionVersion: 1,
      actionPackageId,
      inputsBinding,
      authAccountId,
    },
  };

  const resp = await clayFetch<EnrichmentFieldResponse>(
    `/tables/${tableId}/fields`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  );

  const field = resp.field;
  return {
    fieldId: field.id,
    fieldName: field.name,
    settingsErrors: field.settingsError || [],
  };
}

// ============================================================================
// CSV Import
// ============================================================================

/**
 * Parse a single CSV line, handling quoted fields with commas and escaped quotes.
 */
function parseCSVRow(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Import a CSV file from the user's device into a Clay table.
 * Reads the file via Northlight files API, uploads to Clay's S3 import bucket,
 * creates an import job, and polls until completion.
 */
export async function importCSV(
  params: ImportCSVInput,
): Promise<ImportCSVOutput> {
  const { workspaceId, filePath, csvContent, tableId, workbookId, tableName } =
    params;

  if (!workspaceId) throw new Validation('importCSV: workspaceId is required');
  if (!filePath && !csvContent) {
    throw new Validation('importCSV: either filePath or csvContent is required');
  }
  if (!tableId && !workbookId) {
    throw new Validation(
      'importCSV: either tableId (import to existing table) or workbookId (create new table) is required',
    );
  }

  // 1. Read CSV content: from device file or use provided content
  let csvText: string;
  let buf: ArrayBuffer | undefined;
  if (csvContent) {
    csvText = csvContent;
  } else {
    if (!window.__vallum_files) {
      throw new UpstreamError(
        'importCSV: Northlight files API not available. Ensure the Northlight agent is running.',
      );
    }
    buf = await window.__vallum_files.read({ path: filePath! });
    csvText = new TextDecoder().decode(buf);
  }

  // 2. Parse headers and build preview rows
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) {
    throw new Validation(
      'importCSV: CSV must have a header row and at least one data row',
    );
  }

  const headers = parseCSVRow(lines[0]);
  if (headers.length === 0) {
    throw new Validation('importCSV: no column headers found in CSV');
  }

  // Clay expects: first record = header-to-header mapping, then up to 5 preview rows
  const previewRecords: Array<Record<string, string>> = [];
  const headerRec: Record<string, string> = {};
  for (const h of headers) headerRec[h] = h;
  previewRecords.push(headerRec);

  for (let i = 1; i < Math.min(lines.length, 6); i++) {
    const vals = parseCSVRow(lines[i]);
    const rec: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      rec[headers[j]] = vals[j] || '';
    }
    previewRecords.push(rec);
  }

  const fileName = filePath ? filePath.split('/').pop() : 'import.csv';
  if (!fileName) {
    throw new Validation('importCSV: could not extract filename from filePath');
  }

  // 3. Get signed S3 upload URL
  const signed = await clayFetch<{
    url: string;
    fields: Record<string, string>;
  }>('/imports/signed-s3-post-url', {
    method: 'POST',
    body: JSON.stringify({ filename: fileName, uploadMode: 'import' }),
  });

  // 4. Upload CSV to S3 via multipart form
  const formData = new FormData();
  for (const [k, v] of Object.entries(signed.fields)) {
    formData.append(k, v);
  }
  const blobData = buf
    ? new Blob([buf], { type: 'text/csv' })
    : new Blob([csvText], { type: 'text/csv' });
  formData.append('file', blobData, fileName);

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', signed.url, true);
    xhr.timeout = 120000;
    xhr.onload = () => {
      if (xhr.status >= 400) {
        reject(
          new UpstreamError(`importCSV: S3 upload failed with status ${xhr.status}`),
        );
      } else {
        resolve();
      }
    };
    xhr.onerror = () => reject(new UpstreamError('importCSV: S3 upload network error'));
    xhr.ontimeout = () =>
      reject(new UpstreamError('importCSV: S3 upload timeout (120s)'));
    xhr.send(formData);
  });

  const s3Key = signed.fields.key;

  // 5. Determine target table and build field mapping
  let targetTableId = tableId;
  const map: Record<string, string> = {};

  if (targetTableId) {
    // Import to existing table; auto-map CSV headers to matching field names
    const tableData = await clayFetch<TableResponse>(
      `/tables/${targetTableId}`,
    );
    const fields = tableData.table.fields || [];
    for (const f of fields) {
      if (headers.includes(f.name)) {
        map[f.id] = `{{"${f.name}"}}`;
      }
    }
    if (Object.keys(map).length === 0) {
      throw new ContractDrift(
        `importCSV: no CSV columns match existing table fields. ` +
          `CSV headers: [${headers.join(', ')}]. ` +
          `Table fields: [${fields.map((f) => f.name).join(', ')}]`,
      );
    }
  } else {
    // Create new table and fields from CSV headers
    const name = tableName || fileName.replace(/\.csv$/i, '');
    const tableResp = await clayFetch<{ table: { id: string } }>('/tables', {
      method: 'POST',
      body: JSON.stringify({
        name,
        type: 'spreadsheet',
        workspaceId,
        template: 'empty',
        workbookId,
        callerName: 'import csv',
        icon: { emoji: '🧩' },
        sourceSettings: {},
      }),
    });
    targetTableId = tableResp.table.id;

    // Create a text field for each CSV header in parallel
    const fieldResults = await Promise.all(
      headers.map((header) =>
        clayFetch<{ field: { id: string; name: string } }>(
          `/tables/${targetTableId}/fields`,
          {
            method: 'POST',
            body: JSON.stringify({
              name: header,
              type: 'text',
              typeSettings: { dataTypeSettings: { type: 'text' } },
            }),
          },
        ),
      ),
    );

    for (let i = 0; i < headers.length; i++) {
      map[fieldResults[i].field.id] = `{{"${headers[i]}"}}`;
    }
  }

  // 6. Create import job
  const importResp = await clayFetch<{
    id: string;
    state: { status: string; numRowsSoFar: number; totalSizeBytes: number };
  }>('/imports', {
    method: 'POST',
    body: JSON.stringify({
      config: {
        source: {
          type: 'S3_CSV',
          filename: fileName,
          key: s3Key,
          recordKeys: headers,
          records: previewRecords,
          hasHeader: true,
          fieldDelimiter: ',',
          uploadMode: 'import',
        },
        destination: { type: 'TABLE', tableId: targetTableId },
        map,
        isImportWithoutRun: false,
      },
      workspaceId,
    }),
  });

  // 7. Poll for completion (max 120 seconds)
  const importId = importResp.id;
  let status = importResp.state.status;
  let numRows = importResp.state.numRowsSoFar;

  for (let i = 0; i < 60; i++) {
    if (status === 'FINISHED') break;
    await new Promise((r) => setTimeout(r, 2000));
    const poll = await clayFetch<{
      state: {
        status: string;
        numRowsSoFar: number;
        isStopped?: boolean;
      };
    }>(`/imports/${importId}`);
    status = poll.state.status;
    numRows = poll.state.numRowsSoFar;
    if (poll.state.isStopped) break;
    if (!['INITIALIZED', 'ACTIVE', 'FINISHED'].includes(status)) {
      throw new UpstreamError(
        `importCSV: import ${importId} has unexpected status: ${status}`,
      );
    }
  }

  if (status !== 'FINISHED') {
    throw new UpstreamError(
      `importCSV: import did not complete within 120 seconds. ` +
        `Status: ${status}, rows processed: ${numRows}`,
    );
  }

  return {
    importId,
    tableId: targetTableId!,
    status,
    numRows,
  };
}
