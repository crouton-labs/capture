/**
 * HubSpot Imports Operations
 *
 * READ-ONLY operations for tracking CRM data imports and their status.
 */

import { throwForStatus } from '@vallum/_runtime';

export interface ImportCounters {
  TOTAL_ROWS: number;
  PROPERTY_VALUES_EMITTED: number;
  CREATED_OBJECTS: number;
  ASSOCIATIONS_EMITTED: number;
  ASSOCIATIONS_CREATED: number;
  ERRORS: number;
  UNIQUE_OBJECTS_WRITTEN: number;
  MAPPED_COLUMNS: number;
  UNMAPPED_COLUMNS: number;
}

export interface ObjectList {
  objectType: string;
  listId: string;
}

export interface ImportRecord {
  id: string;
  importName: string;
  createdAt: string;
  updatedAt: string;
  state: 'DONE' | 'STARTED' | 'PROCESSING' | 'FAILED' | 'CANCELED';
  metadata: {
    objectLists: ObjectList[];
    counters: ImportCounters;
    fileIds: string[];
  };
  importRequestJson: {
    portalId: number;
    language: string;
    dateFormat: string;
    importOperations: Record<string, string>;
  };
}

export async function listImports(opts: {
  csrf: string;
  portalId: string;
  limit?: number;
  offset?: number;
}): Promise<{
  results: ImportRecord[];
}> {
  const limit = opts.limit ?? 25;
  const offset = opts.offset ?? 0;

  const url = new URL(`${window.location.origin}/api/crm/v3/imports`);
  url.searchParams.set('portalId', opts.portalId);
  url.searchParams.set('limit', String(limit));
  if (offset > 0) {
    url.searchParams.set('offset', String(offset));
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'x-hubspot-csrf-hubspotapi': opts.csrf,
    },
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();

  return {
    results: data.results || [],
  };
}

export async function getImport(opts: {
  csrf: string;
  portalId: string;
  importId: string;
}): Promise<ImportRecord> {
  const url = new URL(
    `${window.location.origin}/api/crm/v3/imports/${opts.importId}`,
  );
  url.searchParams.set('portalId', opts.portalId);

  const response = await fetch(url.toString(), {
    method: 'GET',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'x-hubspot-csrf-hubspotapi': opts.csrf,
    },
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();
  return data;
}
