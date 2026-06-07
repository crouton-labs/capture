/**
 * Apollo Imports Module
 *
 * CSV file import to Apollo lists via the prospect_imports API.
 * Uses the Northlight files API to read file content from device/cloud storage.
 */

import { UpstreamError, Validation } from '@vallum/_runtime';

import type { ImportCsvToListOutput } from '../schemas';

declare const window: Window & {
  __vallum_files?: {
    read(identifier: string | { path: string }): Promise<ArrayBuffer>;
  };
};

/**
 * Import contacts from a CSV file into an Apollo list.
 * Reads the file via Northlight files API, analyzes column mappings, and imports to a new or existing list.
 */
export async function importCsvToList(opts: {
  fileRef?: { path: string; name: string };
  csvContent?: string;
  fileName?: string;
  listName: string;
  mapping?: Record<string, string>;
  actionIfDuplicate?: 'update' | 'skip';
  emailEnrichment?: boolean;
}): Promise<ImportCsvToListOutput> {
  const {
    fileRef,
    csvContent,
    fileName: userFileName,
    listName,
    mapping: userMapping,
    actionIfDuplicate = 'update',
    emailEnrichment = true,
  } = opts;

  if (!fileRef && !csvContent) {
    throw new Validation(
      'Either fileRef or csvContent is required. Use the @vallum/files library save() to get a file reference, or pass CSV content directly.',
    );
  }
  if (!listName) throw new Validation('listName is required');

  // Build File object from fileRef or csvContent
  let file: File;
  let resolvedFileName: string;

  if (fileRef) {
    if (!window.__vallum_files) {
      throw new Validation(
        'Northlight files API not available. Ensure the Northlight agent is running.',
      );
    }
    const buffer = await window.__vallum_files.read(fileRef);
    resolvedFileName = fileRef.name || 'import.csv';
    file = new File([buffer], resolvedFileName, { type: 'text/csv' });
  } else {
    resolvedFileName = userFileName || 'import.csv';
    file = new File([csvContent!], resolvedFileName, { type: 'text/csv' });
  }

  const base = window.location.origin;

  // 1. Analyze CSV to get field mappings and attachment_id
  const analyzeForm = new FormData();
  analyzeForm.append('uploaded_file', file);

  const analyzeResp = await fetch(`${base}/api/v1/prospect_imports/analyze`, {
    method: 'POST',
    credentials: 'include',
    body: analyzeForm,
  });

  if (!analyzeResp.ok) {
    throw new UpstreamError(
      `CSV analyze failed: ${analyzeResp.status}. Ensure the file is a valid CSV. URL: ${window.location.href}`,
    );
  }

  const analyzeData = await analyzeResp.json();
  const attachmentId: string = analyzeData.attachment_id;
  const numRows: number = analyzeData.num_rows || 0;
  const columns: Array<{
    csv_header: string;
    apollo_field: string;
    example_data?: string[];
  }> = analyzeData.columns || [];

  // 2. Build field mapping; use user-provided or auto-detected
  let finalMapping: Record<string, string>;
  if (userMapping) {
    finalMapping = userMapping;
  } else {
    finalMapping = {};
    for (const col of columns) {
      if (col.csv_header && col.apollo_field) {
        finalMapping[col.csv_header] = col.apollo_field;
      }
    }
  }

  // 3. Import CSV to list
  const importForm = new FormData();
  importForm.append('uploaded_file', file);
  importForm.append('name', resolvedFileName);
  importForm.append('attachment_id', attachmentId);
  importForm.append('mapping', JSON.stringify(finalMapping));
  importForm.append('append_label_names', JSON.stringify([listName]));
  importForm.append('action_if_duplicate', actionIfDuplicate);
  importForm.append('owner_update_policy', 'skip');
  importForm.append(
    'email_enrichment_type',
    emailEnrichment ? 'waterfall' : 'none',
  );
  importForm.append('needs_email_enrichment', String(emailEnrichment));
  importForm.append('push_to_salesforce', 'false');
  importForm.append('try_to_find_account_domain', 'true');
  importForm.append('try_to_find_account_location', 'true');
  importForm.append('auto_assign_accounts', 'update');

  const importResp = await fetch(`${base}/api/v1/prospect_imports/import`, {
    method: 'POST',
    credentials: 'include',
    body: importForm,
  });

  if (!importResp.ok) {
    let errText = '';
    try {
      errText = await importResp.text();
    } catch {
      /* ignore */
    }
    throw new UpstreamError(`CSV import failed: ${importResp.status}. ${errText}`);
  }

  const importData = await importResp.json();
  const importJob =
    (importData.prospect_imports as Array<Record<string, unknown>>)?.[0] || {};
  const labels =
    (importData.labels as Array<{ name: string; id: string }>) || [];
  const matchedList = labels.find((l) => l.name === listName);

  return {
    success: true,
    importId: (importJob.id as string) || '',
    fileName: resolvedFileName,
    rowCount: (importJob.row_count as number) || numRows,
    listName,
    listId: matchedList?.id || '',
    mapping: finalMapping,
    detectedColumns: columns.map((c) => ({
      csvHeader: c.csv_header,
      apolloField: c.apollo_field,
    })),
  };
}
