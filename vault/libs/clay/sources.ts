/**
 * Source operations
 */

import { ContractDrift, Validation, NotFound } from '@vallum/_runtime';
import {
  clayFetch,
  fetchFieldMappings,
  type CreateRecordsResponse,
} from './shared';
import { validatePeopleSearchFilters } from './search';
import type {
  ListSourcesOutput,
  DeleteSourceOutput,
  CreateWebhookSourceInput,
  CreateWebhookSourceOutput,
  CreateGoogleSheetsSourceInput,
  CreateGoogleSheetsSourceOutput,
  CreateCrmImportSourceInput,
  CreateCrmImportSourceOutput,
  CreateActionSourceInput,
  CreateActionSourceOutput,
  CreateSalesNavSourceInput,
  CreateSalesNavSourceOutput,
  GetSourceRunsInput,
  GetSourceRunsOutput,
  TriggerSourceSyncInput,
  TriggerSourceSyncOutput,
  PeopleSearchFilters,
  CreateSourceFromSearchInput,
  CreateSourceFromSearchOutput,
  AddPeopleSearchToTableInput,
  AddPeopleSearchToTableOutput,
} from './schemas';

interface SourceEntry {
  id: string;
  name: string;
  type: string;
  createdAt: string;
  config?: Record<string, unknown>;
}

/**
 * List data sources on a table.
 * Reads sourceIds from table tableSettings, then fetches each source individually.
 */
export async function listSources(opts: {
  tableId: string;
}): Promise<ListSourcesOutput> {
  const { tableId } = opts;

  if (!tableId) {
    throw new Validation('tableId is required');
  }

  // GET /sources?tableId= returns empty (broken endpoint).
  // Source–table links are stored in tableSettings.sourceIds on the table.
  interface TableResponse {
    table: {
      id: string;
      tableSettings?: { sourceIds?: string[] };
    };
  }

  const tableData = await clayFetch<TableResponse>(`/tables/${tableId}`);

  const sourceIds = tableData.table.tableSettings?.sourceIds || [];

  if (sourceIds.length === 0) {
    return { sources: [], totalCount: 0 };
  }

  const results = await Promise.all(
    sourceIds.map(async (sourceId) => {
      try {
        const source = await clayFetch<SourceEntry>(`/sources/${sourceId}`);
        return { id: source.id, name: source.name, type: source.type };
      } catch {
        return null;
      }
    }),
  );

  const sources = results.filter((s): s is NonNullable<typeof s> => s !== null);

  return {
    sources,
    totalCount: sources.length,
  };
}

/**
 * Delete a data source.
 */

/**
 * Delete a data source.
 */
export async function deleteSource(opts: {
  sourceId: string;
  deleteRecords?: boolean;
}): Promise<DeleteSourceOutput> {
  const { sourceId, deleteRecords = false } = opts;

  if (!sourceId || typeof sourceId === 'boolean') {
    throw new Validation('deleteSource: sourceId is required and must be a string');
  }

  if (typeof deleteRecords !== 'boolean') {
    throw new Validation(
      'deleteSource: deleteRecords must be a boolean (true/false), got ' +
        typeof deleteRecords,
    );
  }

  await clayFetch(`/sources/${sourceId}`, {
    method: 'DELETE',
    body: JSON.stringify({ deleteRecords }),
  });

  return {
    success: true,
  };
}

// ============================================================================
// Additional Functions
// ============================================================================

/**
 * Rename a folder.
 */

/**
 * Create a webhook source on a table. Returns a unique webhook URL.
 */
export async function createWebhookSource(
  opts: CreateWebhookSourceInput,
): Promise<CreateWebhookSourceOutput> {
  const { workspaceId, tableId, name = 'Webhook Source' } = opts;

  if (!workspaceId) throw new Validation('workspaceId is required');
  if (!tableId) throw new Validation('tableId is required');

  const data = await clayFetch<{
    id: string;
    name: string;
    state: { url: string };
  }>('/sources', {
    method: 'POST',
    body: JSON.stringify({
      tableId,
      workspaceId: Number(workspaceId),
      name,
      type: 'webhook',
      typeSettings: {},
    }),
  });

  // Register the new source in the table's tableSettings.sourceIds
  // so listSources (which reads from table data) can find it.
  interface TableWithSettings {
    table: {
      id: string;
      tableSettings?: { sourceIds?: string[] };
    };
  }

  const tableData = await clayFetch<TableWithSettings>(`/tables/${tableId}`);
  const existingIds = tableData.table.tableSettings?.sourceIds ?? [];

  await clayFetch(`/tables/${tableId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      tableSettings: {
        ...tableData.table.tableSettings,
        sourceIds: [...existingIds, data.id],
      },
    }),
  });

  return {
    sourceId: data.id,
    webhookUrl: data.state.url,
    name: data.name,
  };
}

// ============================================================================
// CSV Source
// ============================================================================

// ============================================================================
// Google Sheets Source
// ============================================================================

/**
 * Create a Google Sheets source on a table.
 * Pulls rows from a Google Spreadsheet into the Clay table.
 * Requires a connected Google account (appAccountId from listAppAccounts).
 */
export async function createGoogleSheetsSource(
  opts: CreateGoogleSheetsSourceInput,
): Promise<CreateGoogleSheetsSourceOutput> {
  const {
    workspaceId,
    tableId,
    spreadsheetUrl,
    appAccountId,
    sheetId,
    name = 'Google Sheets',
    columnMapping,
  } = opts;

  if (!workspaceId) throw new Validation('workspaceId is required');
  if (!tableId) throw new Validation('tableId is required');
  if (!spreadsheetUrl) throw new Validation('spreadsheetUrl is required');

  const typeSettings: Record<string, unknown> = {
    actionKey: 'google-sheets-source-v2',
    actionVersion: '1',
    actionPackageId: 'b52dbb55-6b36-4b63-9f8c-21d923353045',
    id: spreadsheetUrl,
  };

  if (appAccountId) {
    typeSettings.authAccountId = appAccountId;
  }
  if (sheetId !== undefined) {
    typeSettings.sheetId = sheetId;
  }
  if (columnMapping) {
    typeSettings.columnMapping = columnMapping;
  }

  const source = await clayFetch<{
    id: string;
    name: string;
    type: string;
    typeSettings: Record<string, unknown>;
    state: {
      action?: { status: string; message?: string };
      numSourceRecords: number;
    };
    createdAt: string;
  }>('/sources', {
    method: 'POST',
    body: JSON.stringify({
      tableId,
      workspaceId: Number(workspaceId),
      name,
      type: 'v3-action',
      typeSettings,
    }),
  });

  // Register the new source in the table's tableSettings.sourceIds
  // so listSources (which reads from table data) can find it.
  interface TableWithSettings {
    table: {
      id: string;
      tableSettings?: { sourceIds?: string[] };
    };
  }

  const tableData = await clayFetch<TableWithSettings>(`/tables/${tableId}`);
  const existingIds = tableData.table.tableSettings?.sourceIds ?? [];

  await clayFetch(`/tables/${tableId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      tableSettings: {
        ...tableData.table.tableSettings,
        sourceIds: [...existingIds, source.id],
      },
    }),
  });

  return {
    sourceId: source.id,
    name: source.name,
    status: source.state.action?.status ?? 'CREATED',
    message: source.state.action?.message,
    numSourceRecords: source.state.numSourceRecords,
  };
}

// ============================================================================
// CRM Import Source
// ============================================================================

/** Known CRM source action keys and their package IDs. */
const CRM_ACTION_MAP: Record<
  string,
  { actionKey: string; actionPackageId: string }
> = {
  hubspot: {
    actionKey: 'hubspot-crm-objects-source',
    actionPackageId: 'a2584689-b965-4a25-847d-17b7abcddca3',
  },
  salesforce: {
    actionKey: 'salesforce-records-view-source-v2',
    actionPackageId: 'd0c0a70d-7c1e-40de-b214-9d8d82672770',
  },
  'salesforce-report': {
    actionKey: 'salesforce-report-source',
    actionPackageId: 'd0c0a70d-7c1e-40de-b214-9d8d82672770',
  },
  'salesforce-soql': {
    actionKey: 'salesforce-soql-source',
    actionPackageId: 'd0c0a70d-7c1e-40de-b214-9d8d82672770',
  },
};

/**
 * Create a CRM import source on a table.
 * Imports contacts, companies, deals, or other objects from a connected
 * HubSpot or Salesforce account into the Clay table.
 */
export async function createCrmImportSource(
  opts: CreateCrmImportSourceInput,
): Promise<CreateCrmImportSourceOutput> {
  const { workspaceId, tableId, crmType, appAccountId, name } = opts;

  if (!workspaceId) throw new Validation('workspaceId is required');
  if (!tableId) throw new Validation('tableId is required');
  if (!crmType) throw new Validation('crmType is required');

  const actionConfig = CRM_ACTION_MAP[crmType];
  if (!actionConfig) {
    throw new Validation(
      `Unknown crmType "${crmType}". Valid values: ${Object.keys(CRM_ACTION_MAP).join(', ')}`,
    );
  }

  const sourceName =
    name ?? `${crmType.charAt(0).toUpperCase() + crmType.slice(1)} Import`;

  const typeSettings: Record<string, unknown> = {
    actionKey: actionConfig.actionKey,
    actionPackageId: actionConfig.actionPackageId,
  };

  if (appAccountId) {
    typeSettings.authAccountId = appAccountId;
  }

  const source = await clayFetch<{
    id: string;
    name: string;
    type: string;
    typeSettings: Record<string, unknown>;
    state: {
      action?: { status: string; message?: string };
      numSourceRecords: number;
    };
    createdAt: string;
  }>('/sources', {
    method: 'POST',
    body: JSON.stringify({
      tableId,
      workspaceId: Number(workspaceId),
      name: sourceName,
      type: 'v3-action',
      typeSettings,
    }),
  });

  // Register the new source in the table's tableSettings.sourceIds
  // so listSources (which reads from table data) can find it.
  interface TableWithSettings {
    table: {
      id: string;
      tableSettings?: { sourceIds?: string[] };
    };
  }

  const tableData = await clayFetch<TableWithSettings>(`/tables/${tableId}`);
  const existingIds = tableData.table.tableSettings?.sourceIds ?? [];

  await clayFetch(`/tables/${tableId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      tableSettings: {
        ...tableData.table.tableSettings,
        sourceIds: [...existingIds, source.id],
      },
    }),
  });

  return {
    sourceId: source.id,
    name: source.name,
    actionKey: actionConfig.actionKey,
    status: source.state.action?.status ?? 'CREATED',
    message: source.state.action?.message,
    numSourceRecords: source.state.numSourceRecords,
  };
}

// ============================================================================
// Generic Action Source
// ============================================================================

/**
 * Create any v3-action source on a table using an entityId from searchEnrichments().
 * Supports 40+ source types: Apollo, Dynamics 365, Snowflake, BigQuery, Airtable,
 * GitHub, Reddit, X/Twitter, Google Search, Typeform, Apify, PhantomBuster, etc.
 */
export async function createActionSource(
  opts: CreateActionSourceInput,
): Promise<CreateActionSourceOutput> {
  const {
    workspaceId,
    tableId,
    entityId,
    appAccountId,
    inputs,
    name,
    scheduleConfig,
  } = opts;

  if (!workspaceId)
    throw new Validation('createActionSource: workspaceId is required');
  if (!tableId) throw new Validation('createActionSource: tableId is required');
  if (!entityId) throw new Validation('createActionSource: entityId is required');

  // Parse entityId format: "{actionPackageId}/{actionKey}"
  const slashIdx = entityId.indexOf('/');
  if (slashIdx === -1) {
    throw new Validation(
      `createActionSource: entityId must be in "{actionPackageId}/{actionKey}" format. Got: "${entityId}". ` +
        `Use searchEnrichments({types: ["source_action"]}) to get valid entityIds.`,
    );
  }
  const actionPackageId = entityId.slice(0, slashIdx);
  const actionKey = entityId.slice(slashIdx + 1);

  const typeSettings: Record<string, unknown> = {
    actionKey,
    actionPackageId,
  };

  if (appAccountId) {
    typeSettings.authAccountId = appAccountId;
  }

  if (inputs) {
    typeSettings.inputs = inputs;
    typeSettings.hasEvaluatedInputs = true;
  }

  if (scheduleConfig) {
    typeSettings.scheduleConfig = scheduleConfig;
  }

  const sourceName =
    name ??
    actionKey.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  const source = await clayFetch<{
    id: string;
    name: string;
    type: string;
    typeSettings: Record<string, unknown>;
    state: {
      action?: { status: string; message?: string };
      numSourceRecords: number;
    };
    createdAt: string;
  }>('/sources', {
    method: 'POST',
    body: JSON.stringify({
      tableId,
      workspaceId: Number(workspaceId),
      name: sourceName,
      type: 'v3-action',
      typeSettings,
    }),
  });

  // Register the new source in the table's tableSettings.sourceIds
  interface TableWithSettings {
    table: {
      id: string;
      tableSettings?: { sourceIds?: string[] };
    };
  }

  const tableData = await clayFetch<TableWithSettings>(`/tables/${tableId}`);
  const existingIds = tableData.table.tableSettings?.sourceIds ?? [];

  await clayFetch(`/tables/${tableId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      tableSettings: {
        ...tableData.table.tableSettings,
        sourceIds: [...existingIds, source.id],
      },
    }),
  });

  return {
    sourceId: source.id,
    name: source.name,
    actionKey,
    status: source.state.action?.status ?? 'CREATED',
    message: source.state.action?.message,
    numSourceRecords: source.state.numSourceRecords,
  };
}

// ============================================================================
// Sales Navigator Source (Prospector)
// ============================================================================

/** Action config for Clay's people prospector (powered by Mixrank/LinkedIn). */
const PROSPECTOR_ACTION = {
  actionPackageId: 'e251a70e-46d7-4f3a-b3ef-a211ad3d8bd2',
  actionKey: 'find-lists-of-people-with-mixrank-source',
} as const;

/**
 * Build prospector input from people search filters.
 * Mirrors the shape the run-enrichment endpoint expects.
 */
function buildProspectorInputs(
  filters: PeopleSearchFilters,
  limit: number,
): Record<string, unknown> {
  return {
    about_keywords: filters.about_keywords ?? [],
    certification_keywords: filters.certification_keywords ?? [],
    company_description_keywords: filters.company_description_keywords ?? [],
    company_description_keywords_exclude:
      filters.company_description_keywords_exclude ?? [],
    company_identifier: filters.company_identifier ?? [],
    company_industries_exclude: filters.company_industries_exclude ?? [],
    company_industries_include: filters.company_industries_include ?? [],
    company_record_id: [],
    company_sizes: filters.company_sizes ?? [],
    company_table_id: '',
    connection_count: filters.connection_count ?? null,
    current_role_max_months_since_start_date:
      filters.current_role_max_months_since_start_date ?? null,
    current_role_min_months_since_start_date:
      filters.current_role_min_months_since_start_date ?? null,
    exclude_entities_configuration: [],
    exclude_entities_bitmap: null,
    exclude_entity_bitmap: null,
    exclude_people_identifiers_mixed: [],
    previous_entities_bitmap: null,
    experience_count: filters.experience_count ?? null,
    follower_count: filters.follower_count ?? null,
    headline_keywords: filters.headline_keywords ?? [],
    include_past_experiences: filters.include_past_experiences ?? false,
    job_description_keywords: filters.job_description_keywords ?? [],
    job_functions: filters.job_functions ?? [],
    job_title_exact_keyword_match:
      filters.job_title_exact_keyword_match ?? false,
    job_title_exact_match: filters.job_title_exact_match ?? false,
    job_title_mode: filters.job_title_mode ?? 'smart',
    job_title_exclude_keywords: filters.job_title_exclude_keywords ?? [],
    job_title_keywords: filters.job_title_keywords ?? [],
    job_title_seniority_levels: filters.job_title_seniority_levels ?? [],
    languages: filters.languages ?? [],
    limit,
    locations: filters.locations ?? [],
    locations_exclude: filters.locations_exclude ?? [],
    location_cities_exclude: filters.location_cities_exclude ?? [],
    location_cities_include: filters.location_cities_include ?? [],
    location_countries_exclude: filters.location_countries_exclude ?? [],
    location_countries_include: filters.location_countries_include ?? [],
    location_regions_exclude: filters.location_regions_exclude ?? [],
    location_regions_include: filters.location_regions_include ?? [],
    location_states_exclude: filters.location_states_exclude ?? [],
    location_states_include: filters.location_states_include ?? [],
    max_connection_count: filters.max_connection_count ?? null,
    max_experience_count: filters.max_experience_count ?? null,
    max_follower_count: filters.max_follower_count ?? null,
    name: '',
    names: [],
    profile_keywords: filters.profile_keywords ?? [],
    role_range_end_month: null,
    role_range_start_month: null,
    school_names: filters.school_names ?? [],
    search_raw_location: filters.search_raw_location ?? false,
    start_from_method: 'CsvOfCompanies',
    result_count: true,
  };
}

/**
 * Create a LinkedIn Sales Navigator (prospector) source on a table.
 * Stores people search criteria as a persistent source that can be
 * re-imported or monitored for changes.
 *
 * Uses the same people search filters as searchPeople / createPeopleTable.
 * The source type is "prospector-source" backed by Clay's Mixrank/LinkedIn
 * data provider.
 */
export async function createSalesNavSource(
  opts: CreateSalesNavSourceInput,
): Promise<CreateSalesNavSourceOutput> {
  const {
    workspaceId,
    tableId,
    filters,
    limit = 1000,
    name = 'Sales Nav Import',
  } = opts;

  if (!workspaceId) throw new Validation('workspaceId is required');
  if (!tableId) throw new Validation('tableId is required');
  if (!filters) throw new Validation('filters is required');

  validatePeopleSearchFilters(filters);

  const inputs = buildProspectorInputs(filters, limit);

  const source = await clayFetch<{
    id: string;
    name: string;
    type: string;
    typeSettings: Record<string, unknown>;
    state: { numSourceRecords: number };
    createdAt: string;
  }>('/sources', {
    method: 'POST',
    body: JSON.stringify({
      tableId,
      workspaceId: Number(workspaceId),
      name,
      type: 'prospector-source',
      typeSettings: {
        ...PROSPECTOR_ACTION,
        inputs,
      },
    }),
  });

  // Register the new source in the table's tableSettings.sourceIds
  // so listSources (which reads from table data) can find it.
  interface TableWithSettings {
    table: {
      id: string;
      tableSettings?: { sourceIds?: string[] };
    };
  }

  const tableData = await clayFetch<TableWithSettings>(`/tables/${tableId}`);
  const existingIds = tableData.table.tableSettings?.sourceIds ?? [];

  await clayFetch(`/tables/${tableId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      tableSettings: {
        ...tableData.table.tableSettings,
        sourceIds: [...existingIds, source.id],
      },
    }),
  });

  return {
    sourceId: source.id,
    name: source.name,
    type: source.type,
    numSourceRecords: source.state.numSourceRecords,
  };
}

/**
 * Get execution runs for a source.
 */
export async function getSourceRuns(
  opts: GetSourceRunsInput,
): Promise<GetSourceRunsOutput> {
  const { sourceId, limit = 50 } = opts;

  if (!sourceId) {
    throw new Validation('getSourceRuns: sourceId is required');
  }

  const data = await clayFetch<{
    runs: Array<{
      id: string;
      status: string;
      createdAt: string;
      completedAt: string | null;
      statusMessage: string | null;
      numberOfRowsAdded: number | null;
    }>;
  }>(`/sources/${sourceId}/runs?limit=${limit}`);

  return {
    runs: data.runs.map((run) => ({
      id: run.id,
      status: run.status,
      createdAt: run.createdAt,
      completedAt: run.completedAt ?? undefined,
      statusMessage: run.statusMessage ?? undefined,
      numberOfRowsAdded: run.numberOfRowsAdded ?? undefined,
    })),
  };
}

/**
 * Trigger a prospector source to re-import data into its table.
 * Creates a new source run that pulls fresh people/company data.
 */
export async function triggerSourceSync(
  opts: TriggerSourceSyncInput,
): Promise<TriggerSourceSyncOutput> {
  const { sourceId, workspaceId } = opts;

  if (!sourceId) {
    throw new Validation('triggerSourceSync: sourceId is required');
  }

  let wsId = workspaceId;

  if (!wsId) {
    // Fetch source to get workspaceId
    const source = await clayFetch<{
      id: string;
      workspaceId: number;
    }>(`/sources/${sourceId}`);
    wsId = String(source.workspaceId);
  }

  const data = await clayFetch<{
    sourceRunId: string;
    jobId: string;
  }>(`/workspaces/${wsId}/prospector/sources/${sourceId}/trigger`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

  return {
    sourceRunId: data.sourceRunId,
    jobId: data.jobId,
  };
}

/**
 * Create a new workbook, table, and people-search source from search filters
 * via the Clay wizard. Populates the table with search results.
 */
export async function createSourceFromSearch(
  opts: CreateSourceFromSearchInput,
): Promise<CreateSourceFromSearchOutput> {
  const {
    workspaceId,
    filters = {} as PeopleSearchFilters,
    previewTaskId,
    parentFolderId,
    workbookId,
    limit,
  } = opts;

  if (!workspaceId) {
    throw new Validation('createSourceFromSearch: workspaceId is required');
  }

  const searchInputs = buildWizardSearchInputs(filters);

  // Override limit if specified (buildWizardSearchInputs sets limit: null by default)
  if (limit != null) {
    searchInputs.limit = limit;
  }

  const typeSettings: Record<string, unknown> = {
    name: 'Find people',
    iconType: 'User',
    actionKey: 'find-lists-of-people-with-mixrank-source',
    actionPackageId: 'e251a70e-46d7-4f3a-b3ef-a211ad3d8bd2',
    previewTextPath: 'name',
    defaultPreviewText: 'Clay Profile',
    recordsPath: 'people',
    idPath: 'profile_id',
    scheduleConfig: { runSettings: 'once' },
    dedupeOnUniqueIds: true,
    inputs: searchInputs,
    hasEvaluatedInputs: true,
    previewActionKey: 'find-lists-of-people-with-mixrank-source-preview',
  };

  const basicFields = [
    {
      name: 'First Name',
      dataType: 'text',
      formulaText: '{{source}}.first_name',
    },
    {
      name: 'Last Name',
      dataType: 'text',
      formulaText: '{{source}}.last_name',
    },
    { name: 'Full Name', dataType: 'text', formulaText: '{{source}}.name' },
    {
      name: 'Job Title',
      dataType: 'text',
      formulaText: '{{source}}.latest_experience_title',
    },
    {
      name: 'Location',
      dataType: 'text',
      formulaText: '{{source}}.location_name',
    },
    {
      name: 'Company Domain',
      dataType: 'url',
      formulaText: '{{source}}.domain',
    },
    {
      name: 'LinkedIn Profile',
      dataType: 'url',
      formulaText: '{{source}}.url',
      isDedupeField: true,
    },
  ];

  const formInputs: Record<string, unknown> = {
    clientSettings: { tableType: 'people' },
    requiredDataPoint: null,
    basicFields,
    type: 'people',
    typeSettings,
    generatedSampleRecords: null,
    keepSampleRecords: true,
  };

  if (previewTaskId) {
    formInputs.previewActionTaskId = previewTaskId;
  }

  const sessionId = crypto.randomUUID();

  const payload: Record<string, unknown> = {
    workbookId: workbookId ?? null,
    wizardId: 'find-and-enrich-people',
    wizardStepId: 'people-search',
    formInputs,
    sessionId,
    currentStepIndex: 0,
    outputs: [],
    firstUseCase: null,
    parentFolderId: parentFolderId ?? null,
  };

  interface WizardResponse {
    workbookId: string;
    output: {
      type: string;
      stepId: string;
      workbookId: string;
      source: {
        sourceId: string;
        typeSettings: Record<string, unknown>;
      };
      table: {
        tableId: string;
        tableName: string;
        viewId: string;
        fieldIds: string[];
        creditEstimatePerRow: number;
        isNewTable: boolean;
      };
      sourceFieldId: string;
      isNewWorkbook: boolean;
      recordCount: number;
    };
  }

  const data = await clayFetch<WizardResponse>(
    `/workspaces/${workspaceId}/wizard/evaluate-step`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );

  if (!data.output?.table?.tableId) {
    throw new ContractDrift(
      'createSourceFromSearch: wizard response missing table data',
    );
  }

  if (!data.output?.source?.sourceId) {
    throw new ContractDrift(
      'createSourceFromSearch: wizard response missing source data',
    );
  }

  return {
    workbookId: data.workbookId,
    tableId: data.output.table.tableId,
    tableName: data.output.table.tableName,
    viewId: data.output.table.viewId,
    sourceId: data.output.source.sourceId,
    sourceFieldId: data.output.sourceFieldId,
    recordCount: data.output.recordCount,
  };
}

/**
 * Add people matching search filters to an existing table.
 * Uses the wizard to create a temp table with search results,
 * copies records to the target table, then cleans up.
 */
export async function addPeopleSearchToTable(
  opts: AddPeopleSearchToTableInput,
): Promise<AddPeopleSearchToTableOutput> {
  const {
    workspaceId,
    tableId,
    filters = {} as PeopleSearchFilters,
    limit,
  } = opts;

  if (!workspaceId)
    throw new Validation('addPeopleSearchToTable: workspaceId is required');
  if (!tableId) throw new Validation('addPeopleSearchToTable: tableId is required');

  // 1. Get target table's workbookId
  interface TableResponse {
    table: {
      id: string;
      workbookId: string;
    };
  }
  const targetTable = await clayFetch<TableResponse>(`/tables/${tableId}`);
  const targetWorkbookId = targetTable.table.workbookId;

  if (!targetWorkbookId) {
    throw new ContractDrift(
      'addPeopleSearchToTable: could not determine workbookId for target table',
    );
  }

  // 2. Create a temp table via the wizard (populated with search results)
  const wizardResult = await createSourceFromSearch({
    workspaceId,
    filters,
    workbookId: targetWorkbookId,
    limit,
  });

  const tempTableId = wizardResult.tableId;
  const tempViewId = wizardResult.viewId;

  if (wizardResult.recordCount === 0) {
    // No results; clean up temp table and return
    await clayFetch(`/workspaces/${workspaceId}/resources/`, {
      method: 'DELETE',
      body: JSON.stringify({
        tableIds: [tempTableId],
        workbookIds: [],
        folderIds: [],
        isPermanentDelete: true,
      }),
    });
    return { recordsAdded: 0, sourceId: wizardResult.sourceId };
  }

  // 3. Get all record IDs from the temp table
  interface ListRecordIdsResponse {
    results: string[];
  }
  const idsData = await clayFetch<ListRecordIdsResponse>(
    `/tables/${tempTableId}/views/${tempViewId}/records/ids`,
  );
  const allRecordIds = idsData.results || [];

  if (allRecordIds.length === 0) {
    await clayFetch(`/workspaces/${workspaceId}/resources/`, {
      method: 'DELETE',
      body: JSON.stringify({
        tableIds: [tempTableId],
        workbookIds: [],
        folderIds: [],
        isPermanentDelete: true,
      }),
    });
    return { recordsAdded: 0, sourceId: wizardResult.sourceId };
  }

  // 4. Get field mappings for both tables to find matching fields
  const [targetMappings, tempMappings] = await Promise.all([
    fetchFieldMappings(tableId),
    fetchFieldMappings(tempTableId),
  ]);

  // Find fields that exist in both tables (by name)
  const matchingFieldNames = Object.keys(tempMappings.nameToId).filter(
    (name) =>
      targetMappings.nameToId[name] &&
      name !== 'Created At' &&
      name !== 'Updated At',
  );

  if (matchingFieldNames.length === 0) {
    await clayFetch(`/workspaces/${workspaceId}/resources/`, {
      method: 'DELETE',
      body: JSON.stringify({
        tableIds: [tempTableId],
        workbookIds: [],
        folderIds: [],
        isPermanentDelete: true,
      }),
    });
    throw new Validation(
      `addPeopleSearchToTable: no matching fields between temp table and target table. ` +
        `Target fields: ${Object.keys(targetMappings.nameToId).join(', ')}`,
    );
  }

  // 5. Fetch records in batches and copy to target table
  const BATCH_SIZE = 100;
  let totalAdded = 0;

  for (let i = 0; i < allRecordIds.length; i += BATCH_SIZE) {
    const batchIds = allRecordIds.slice(i, i + BATCH_SIZE);

    // Fetch records from temp table
    interface BulkFetchResult {
      results: Array<{
        id: string;
        tableId: string;
        cells: Record<string, { value: unknown }>;
      }>;
    }
    const batchData = await clayFetch<BulkFetchResult>(
      `/tables/${tempTableId}/bulk-fetch-records`,
      {
        method: 'POST',
        body: JSON.stringify({
          recordIds: batchIds,
          includeExternalContentFieldIds: [],
        }),
      },
    );

    // Map records to target table format (field name → value, only matching fields)
    const targetRecords = (batchData.results ?? []).map((r) => {
      const cells: Record<string, unknown> = {};
      for (const [fieldId, cell] of Object.entries(r.cells)) {
        const fieldName = tempMappings.idToName[fieldId];
        if (fieldName && matchingFieldNames.includes(fieldName)) {
          // Use the target table's field ID directly
          const targetFieldId = targetMappings.nameToId[fieldName];
          if (targetFieldId) {
            cells[targetFieldId] = cell.value;
          }
        }
      }
      return { cells };
    });

    // Insert into target table
    if (targetRecords.length > 0) {
      await clayFetch<CreateRecordsResponse>(`/tables/${tableId}/records`, {
        method: 'POST',
        body: JSON.stringify({ records: targetRecords }),
      });
      totalAdded += targetRecords.length;
    }
  }

  // 6. Delete the temp table
  await clayFetch(`/workspaces/${workspaceId}/resources/`, {
    method: 'DELETE',
    body: JSON.stringify({
      tableIds: [tempTableId],
      workbookIds: [],
      folderIds: [],
      isPermanentDelete: true,
    }),
  });

  return {
    recordsAdded: totalAdded,
    sourceId: wizardResult.sourceId,
  };
}

/**
 * Build search inputs for the wizard evaluate-step endpoint.
 * Matches the shape expected by the wizard's people-search step.
 */
function buildWizardSearchInputs(
  filters: PeopleSearchFilters,
): Record<string, unknown> {
  return {
    start_from_method: 'CsvOfCompanies',
    company_identifier: filters.company_identifier ?? [],
    company_record_id: [],
    company_table_id: '',
    company_audience_segment_id: null,
    include_company_filter_bitmap: null,
    exclude_entities_configuration: [],
    exclude_entities_bitmap: null,
    previous_entities_bitmap: null,
    exclude_entity_bitmap: null,
    languages: filters.languages ?? [],
    certification_keywords: filters.certification_keywords ?? [],
    school_names: filters.school_names ?? [],
    names: [],
    profile_keywords: filters.profile_keywords ?? [],
    headline_keywords: filters.headline_keywords ?? [],
    about_keywords: filters.about_keywords ?? [],
    connection_count: filters.connection_count ?? null,
    max_connection_count: filters.max_connection_count ?? null,
    follower_count: filters.follower_count ?? null,
    max_follower_count: filters.max_follower_count ?? null,
    current_role_min_months_since_start_date:
      filters.current_role_min_months_since_start_date ?? null,
    current_role_max_months_since_start_date:
      filters.current_role_max_months_since_start_date ?? null,
    experience_count: filters.experience_count ?? null,
    max_experience_count: filters.max_experience_count ?? null,
    include_past_experiences: filters.include_past_experiences ?? false,
    exclude_people_identifiers_mixed: [],
    job_title_mode: filters.job_title_mode ?? 'smart',
    job_functions: filters.job_functions ?? [],
    job_title_seniority_levels: filters.job_title_seniority_levels ?? [],
    locations: filters.locations ?? [],
    locations_exclude: filters.locations_exclude ?? [],
    location_cities_exclude: filters.location_cities_exclude ?? [],
    location_cities_include: filters.location_cities_include ?? [],
    location_countries_exclude: filters.location_countries_exclude ?? [],
    location_countries_include: filters.location_countries_include ?? [],
    location_regions_exclude: filters.location_regions_exclude ?? [],
    location_regions_include: filters.location_regions_include ?? [],
    search_raw_location: filters.search_raw_location ?? false,
    location_states_exclude: filters.location_states_exclude ?? [],
    location_states_include: filters.location_states_include ?? [],
    company_sizes: filters.company_sizes ?? [],
    company_industries_exclude: filters.company_industries_exclude ?? [],
    company_industries_include: filters.company_industries_include ?? [],
    company_description_keywords_exclude:
      filters.company_description_keywords_exclude ?? [],
    company_description_keywords: filters.company_description_keywords ?? [],
    limit: null,
    role_range_start_month: null,
    role_range_end_month: null,
    name: '',
    job_title_exclude_keywords: filters.job_title_exclude_keywords ?? [],
    job_title_keywords: filters.job_title_keywords ?? [],
    job_description_keywords: filters.job_description_keywords ?? [],
  };
}

// ============================================================================
// Delete Campaign Webhook
// ============================================================================

/**
 * Delete a webhook from a campaign.
 */
