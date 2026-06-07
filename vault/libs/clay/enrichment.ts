/**
 * Enrichment operations
 */

import { ContractDrift, Validation, NotFound } from '@vallum/_runtime';
import {
  clayFetch,
  type TableData,
  type CreateRecordsResponse,
  type RunEnrichmentResponse,
} from './shared';
import { fetchFieldMappings } from './shared';
import type {
  PeopleSearchFilters,
  CompanySearchFilters,
  RunEnrichmentColumnOutput,
  CreateWaterfallEnrichmentOutput,
  CreatePeopleTableOutput,
  CreateCompanyTableOutput,
  AddEnrichmentColumnInput,
  AddEnrichmentColumnOutput,
  AddCompanySearchToTableInput,
  AddCompanySearchToTableOutput,
  GetActionInputsInput,
  GetActionInputsOutput,
  GetDynamicFieldOptionsInput,
  GetDynamicFieldOptionsOutput,
} from './schemas';

interface WaterfallConfig {
  type: 'actionConfig';
  actionKey: string;
  actionPackageId: string;
  inputsBinding: Array<{ name: string; formulaText: string }>;
  attributePath: string;
  name: string;
}

interface WaterfallFieldGroupResponse {
  fieldGroupMap: Record<
    string,
    {
      type: string;
      name: string;
      settings: Record<string, unknown>;
    }
  >;
  fields: Array<{
    id: string;
    name: string;
    type: string;
  }>;
}

function buildSearchInputs(
  filters: PeopleSearchFilters,
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
  };
}

function buildCompanySearchInputs(
  filters: CompanySearchFilters,
): Record<string, unknown> {
  return {
    description_keywords: filters.description_keywords ?? [],
    description_keywords_exclude: filters.description_keywords_exclude ?? [],
    semantic_description: filters.semantic_description ?? '',
    sizes: filters.sizes ?? [],
    industries: filters.industries ?? [],
    industries_exclude: filters.industries_exclude ?? [],
    types: filters.types ?? [],
    annual_revenues: filters.annual_revenues ?? [],
    company_identifier: filters.company_identifier ?? [],
    country_names: filters.country_names ?? [],
    country_names_exclude: filters.country_names_exclude ?? [],
    locations: filters.locations ?? [],
    locations_exclude: filters.locations_exclude ?? [],
    funding_amounts: filters.funding_amounts ?? [],
    minimum_member_count: filters.minimum_member_count ?? null,
    maximum_member_count: filters.maximum_member_count ?? null,
    minimum_follower_count: filters.minimum_follower_count ?? null,
    exclude_entities_configuration: [],
    exclude_entities_bitmap: null,
    previous_entities_bitmap: null,
    exclude_company_identifiers_mixed: [],
    name: '',
    startFromCompanyType: 'company_identifier',
  };
}

/**
 * Run enrichment on a field.
 * ⚠️ COSTS CREDITS. Runs enrichment on specified fields for records in a view.
 * ALWAYS get user consent before calling.
 */
export async function runEnrichmentColumn(opts: {
  tableId: string;
  fieldIds: string[];
  viewId?: string;
  numRecords?: number;
  recordIds?: string[];
  forceRun?: boolean;
}): Promise<RunEnrichmentColumnOutput> {
  const { tableId, fieldIds, viewId, numRecords, recordIds, forceRun } = opts;

  if (!tableId) {
    throw new Validation('tableId is required');
  }
  if (!fieldIds || fieldIds.length === 0) {
    throw new Validation('fieldIds is required');
  }
  if (!viewId && (!recordIds || recordIds.length === 0)) {
    throw new Validation('Either viewId or recordIds is required');
  }

  let runRecords: Record<string, unknown>;

  if (recordIds && recordIds.length > 0) {
    // Run on specific records by ID
    runRecords = { recordIds };
  } else if (numRecords) {
    runRecords = {
      viewIdTopRecords: {
        viewId,
        numRecords,
      },
    };
  } else {
    runRecords = { viewId };
  }

  const body: Record<string, unknown> = {
    fieldIds,
    runRecords,
    callerName: 'API',
  };

  if (forceRun) {
    body.forceRun = true;
  }

  await clayFetch<RunEnrichmentResponse>(`/tables/${tableId}/run`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });

  return {
    success: true,
  };
}

// ============================================================================
// Waterfall Enrichment
// ============================================================================

/**
 * Add a waterfall enrichment column to a table.
 * ⚠️ The column itself is free to create, but RUNNING it (via runEnrichmentColumn) COSTS CREDITS.
 * Creates a waterfall column that tries multiple email-finding providers in sequence.
 * The column must be run separately via runEnrichmentColumn().
 */
export async function createWaterfallEnrichment(opts: {
  tableId: string;
  attributeEnum: string;
  waterfallFieldName: string;
  fullNameFieldId: string;
  companyDomainFieldId: string;
  linkedInUrlFieldId?: string;
  companyNameFieldId?: string;
}): Promise<CreateWaterfallEnrichmentOutput> {
  const {
    tableId,
    attributeEnum,
    waterfallFieldName,
    fullNameFieldId,
    companyDomainFieldId,
    linkedInUrlFieldId,
    companyNameFieldId,
  } = opts;

  if (!tableId) throw new Validation('tableId is required');
  if (!fullNameFieldId) throw new Validation('fullNameFieldId is required');
  if (!companyDomainFieldId)
    throw new Validation('companyDomainFieldId is required');

  // Build waterfall configs for the email enrichment providers
  const waterfallConfigs: WaterfallConfig[] = [];

  if (attributeEnum === 'person/workEmail') {
    // Standard work email waterfall using Clay's built-in providers
    const providers = [
      {
        actionKey: 'findymail-find-work-email',
        actionPackageId: '9515bb04-4267-4074-94eb-653545c3c38f',
        domainField: 'company_domain',
      },
      {
        actionKey: 'find-email-v2',
        actionPackageId: '9cfc7721-5c91-423b-a0b0-4cc1f42c6089',
        domainField: 'domain',
      },
      {
        actionKey: 'prospeo-find-work-email-v2',
        actionPackageId: '48a31bbb-63e6-4461-8a62-d88bb2cd6b0f',
        domainField: 'company_domain',
      },
      {
        actionKey: 'kitt-find-work-email',
        actionPackageId: '80eadf57-480e-4f7f-bc4a-79708415de44',
        domainField: 'domain',
        nameField: 'fullName',
      },
      {
        actionKey: 'datagma-find-work-email-v3',
        actionPackageId: 'f240a97e-3d3e-4ffa-a85e-8d70afe348a5',
        domainField: 'company_domain',
      },
    ];

    for (const p of providers) {
      const inputsBinding: Array<{ name: string; formulaText: string }> = [
        {
          name: p.nameField || 'full_name',
          formulaText: `{{${fullNameFieldId}}}`,
        },
        { name: p.domainField, formulaText: `{{${companyDomainFieldId}}}` },
      ];

      waterfallConfigs.push({
        type: 'actionConfig',
        actionKey: p.actionKey,
        actionPackageId: p.actionPackageId,
        inputsBinding,
        attributePath: 'email',
        name: 'Find Work Email',
      });
    }
  }

  const payload: Record<string, unknown> = {
    waterfallConfigs,
    waterfallFieldName,
    waterfallGroupName: waterfallFieldName,
    attributeEnum,
    runAsButton: false,
    hideFromViews: true,
    safeToSend: false,
    validationStrategy: 'conservative',
    includeCatchAll: false,
    excludeRoleBased: false,
    excludeDisposable: false,
    maxConsecutiveIdenticalNotFound: 0,
    createDataProviderField: false,
    requireValidationSuccess: false,
    truncateOutput: true,
  };

  // Add validation config for email
  if (attributeEnum === 'person/workEmail') {
    payload.validationActionConfig = {
      actionKey: 'findymail-validate-email',
      actionPackageId: '9515bb04-4267-4074-94eb-653545c3c38f',
      authAccountId: null,
      inputName: 'email',
      additionalValidationInputs: [],
    };
  }

  // Add required inputs binding
  const requiredInputsBinding: Array<{ name: string; formulaText: string }> = [
    { name: 'full-name', formulaText: `{{${fullNameFieldId}}}` },
    { name: 'company-domain', formulaText: `{{${companyDomainFieldId}}}` },
  ];
  if (linkedInUrlFieldId) {
    requiredInputsBinding.push({
      name: 'person-linkedin-url',
      formulaText: `{{${linkedInUrlFieldId}}}`,
    });
  }
  if (companyNameFieldId) {
    requiredInputsBinding.push({
      name: 'company-name',
      formulaText: `{{${companyNameFieldId}}}`,
    });
  }
  payload.requiredInputsBinding = requiredInputsBinding;

  const data = await clayFetch<WaterfallFieldGroupResponse>(
    `/tables/${tableId}/waterfall/v2`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );

  if (!data.fields) {
    throw new ContractDrift('Waterfall enrichment response missing fields');
  }
  if (!data.fieldGroupMap) {
    throw new ContractDrift('Waterfall enrichment response missing fieldGroupMap');
  }

  return {
    fields: data.fields,
    fieldGroupMap: data.fieldGroupMap,
  };
}

// ============================================================================
// People Table (Wizard)
// ============================================================================

/**
 * Create a people table from search filters.
 * Creates a workbook + table + fields, runs search, and populates records.
 * Returns table ID, view ID, workbook ID, and field IDs for use with createWaterfallEnrichment.
 * FREE operation - no credits consumed.
 */
export async function createPeopleTable(opts: {
  workspaceId: string;
  filters?: PeopleSearchFilters;
  previewTaskId?: string;
}): Promise<CreatePeopleTableOutput> {
  const { workspaceId, filters = {} as PeopleSearchFilters } = opts;

  if (!workspaceId)
    throw new Validation('createPeopleTable: workspaceId is required');

  // 1. Create table (auto-creates workbook)
  const tableData = await clayFetch<{
    table: TableData & { workbookId?: string };
    extraData?: { newlyCreatedWorkbook?: boolean };
  }>('/tables', {
    method: 'POST',
    body: JSON.stringify({
      name: 'People Search',
      workspaceId: String(workspaceId),
      type: 'people',
    }),
  });

  const tableId = tableData.table.id;
  const workbookId = tableData.table.workbookId;

  // 2. Add people-specific fields
  const fieldDefs = [
    { name: 'First Name', type: 'text', sourceKey: 'first_name' },
    { name: 'Last Name', type: 'text', sourceKey: 'last_name' },
    { name: 'Full Name', type: 'text', sourceKey: 'name' },
    { name: 'Job Title', type: 'text', sourceKey: 'latest_experience_title' },
    {
      name: 'Company Name',
      type: 'text',
      sourceKey: 'latest_experience_company',
    },
    { name: 'Location', type: 'text', sourceKey: 'location_name' },
    { name: 'Company Domain', type: 'url', sourceKey: 'domain' },
    { name: 'LinkedIn Profile', type: 'url', sourceKey: 'url' },
  ];

  const fieldMap: Record<string, string> = {};
  const sourceKeyMap: Record<string, string> = {}; // fieldId → sourceKey

  for (const fd of fieldDefs) {
    const fieldResp = await clayFetch<{ field: { id: string; name: string } }>(
      `/tables/${tableId}/fields`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: fd.name,
          type: fd.type,
          typeSettings: { dataTypeSettings: { type: fd.type } },
        }),
      },
    );
    fieldMap[fd.name] = fieldResp.field.id;
    sourceKeyMap[fieldResp.field.id] = fd.sourceKey;
  }

  // 3. Run search
  const inputs = buildSearchInputs(filters);
  const searchResp = await clayFetch<RunEnrichmentResponse>(
    '/actions/run-enrichment',
    {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: String(workspaceId),
        enrichmentType: 'find-lists-of-people-with-mixrank-source-preview',
        options: { sync: true, returnTaskId: true, returnActionMetadata: true },
        inputs: { ...inputs, limit: 50, result_count: true },
      }),
    },
  );

  const people = (searchResp.result?.people || []) as unknown as Array<
    Record<string, unknown>
  >;

  // 4. Add records
  if (people.length > 0) {
    const records = people.map((p) => {
      const cells: Record<string, unknown> = {};
      for (const [fieldId, sourceKey] of Object.entries(sourceKeyMap)) {
        if (p[sourceKey] != null) {
          cells[fieldId] = p[sourceKey];
        }
      }
      return { cells };
    });

    await clayFetch<CreateRecordsResponse>(`/tables/${tableId}/records`, {
      method: 'POST',
      body: JSON.stringify({ records }),
    });
  }

  // 5. Get view ID from table metadata
  const tableInfo = await clayFetch<{
    table: TableData & { views?: Array<{ id: string }> };
  }>(`/tables/${tableId}`);
  const viewId =
    tableInfo.table.firstViewId ?? tableInfo.table.views?.[0]?.id ?? '';

  if (!workbookId) {
    throw new ContractDrift('Table created but workbookId missing from response');
  }
  if (!viewId) {
    throw new ContractDrift('Table created but no view found');
  }

  return {
    workbookId,
    tableId,
    viewId,
    fields: fieldMap,
    recordCount: people.length,
  };
}

// ============================================================================
// Company Table (Wizard)
// ============================================================================

/**
 * Create a company table from search filters.
 * Creates a workbook + table + fields, runs search, and populates records.
 * Returns table ID, view ID, workbook ID, and field IDs.
 * FREE operation - no credits consumed.
 */
export async function createCompanyTable(opts: {
  workspaceId: string;
  filters?: CompanySearchFilters;
  previewTaskId?: string;
}): Promise<CreateCompanyTableOutput> {
  const { workspaceId, filters = {} as CompanySearchFilters } = opts;

  if (!workspaceId)
    throw new Validation('createCompanyTable: workspaceId is required');

  // 1. Create table (auto-creates workbook)
  const tableData = await clayFetch<{
    table: TableData & { workbookId?: string };
    extraData?: { newlyCreatedWorkbook?: boolean };
  }>('/tables', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Company Search',
      workspaceId: String(workspaceId),
      type: 'company',
    }),
  });

  const tableId = tableData.table.id;
  const workbookId = tableData.table.workbookId;

  // 2. Add company-specific fields
  const fieldDefs = [
    { name: 'Name', type: 'text', sourceKey: 'name' },
    { name: 'Domain', type: 'url', sourceKey: 'domain' },
    { name: 'Industry', type: 'text', sourceKey: 'industry' },
    { name: 'Size', type: 'text', sourceKey: 'size' },
    { name: 'Location', type: 'text', sourceKey: 'location' },
    { name: 'LinkedIn URL', type: 'url', sourceKey: 'linkedin_url' },
    { name: 'Description', type: 'text', sourceKey: 'description' },
    { name: 'Revenue', type: 'text', sourceKey: 'annual_revenue' },
  ];

  const fieldMap: Record<string, string> = {};
  const sourceKeyMap: Record<string, string> = {}; // fieldId → sourceKey

  for (const fd of fieldDefs) {
    const fieldResp = await clayFetch<{ field: { id: string; name: string } }>(
      `/tables/${tableId}/fields`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: fd.name,
          type: fd.type,
          typeSettings: { dataTypeSettings: { type: fd.type } },
        }),
      },
    );
    fieldMap[fd.name] = fieldResp.field.id;
    sourceKeyMap[fieldResp.field.id] = fd.sourceKey;
  }

  // 3. Run search
  const inputs = buildCompanySearchInputs(filters);
  const searchResp = await clayFetch<RunEnrichmentResponse>(
    '/actions/run-enrichment',
    {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: String(workspaceId),
        enrichmentType: 'find-lists-of-companies-with-mixrank-source-preview',
        options: { sync: true, returnTaskId: true, returnActionMetadata: true },
        inputs: { ...inputs, limit: 50, result_count: true },
      }),
    },
  );

  const companies = (searchResp.result?.companies || []) as unknown as Array<
    Record<string, unknown>
  >;

  // 4. Add records
  if (companies.length > 0) {
    const records = companies.map((c) => {
      const cells: Record<string, unknown> = {};
      for (const [fieldId, sourceKey] of Object.entries(sourceKeyMap)) {
        if (c[sourceKey] != null) {
          cells[fieldId] = c[sourceKey];
        }
      }
      return { cells };
    });

    await clayFetch<CreateRecordsResponse>(`/tables/${tableId}/records`, {
      method: 'POST',
      body: JSON.stringify({ records }),
    });
  }

  // 5. Get view ID from table metadata
  const tableInfo = await clayFetch<{
    table: TableData & { views?: Array<{ id: string }> };
  }>(`/tables/${tableId}`);
  const viewId =
    tableInfo.table.firstViewId ?? tableInfo.table.views?.[0]?.id ?? '';

  if (!workbookId) {
    throw new ContractDrift('Table created but workbookId missing from response');
  }
  if (!viewId) {
    throw new ContractDrift('Table created but no view found');
  }

  return {
    workbookId,
    tableId,
    viewId,
    fields: fieldMap,
    recordCount: companies.length,
  };
}

/**
 * Add companies matching search filters to an existing table.
 * Searches for companies and inserts them directly into the target table.
 */
export async function addCompanySearchToTable(
  opts: AddCompanySearchToTableInput,
): Promise<AddCompanySearchToTableOutput> {
  const {
    workspaceId,
    tableId,
    filters = {} as CompanySearchFilters,
    limit,
  } = opts;

  if (!workspaceId)
    throw new Validation('addCompanySearchToTable: workspaceId is required');
  if (!tableId) throw new Validation('addCompanySearchToTable: tableId is required');

  // Company field name → source key mapping (matches createCompanyTable)
  const sourceKeyByName: Record<string, string> = {
    Name: 'name',
    Domain: 'domain',
    Industry: 'industry',
    Size: 'size',
    Location: 'location',
    'LinkedIn URL': 'linkedin_url',
    Description: 'description',
    Revenue: 'annual_revenue',
  };

  // 1. Get target table's field mappings
  const targetMappings = await fetchFieldMappings(tableId);

  // Find fields that exist in both the target table and our source key map
  const matchingFields = Object.keys(sourceKeyByName).filter(
    (name) => targetMappings.nameToId[name],
  );

  if (matchingFields.length === 0) {
    throw new Validation(
      `addCompanySearchToTable: no matching fields in target table. ` +
        `Expected one or more of: ${Object.keys(sourceKeyByName).join(', ')}. ` +
        `Target fields: ${Object.keys(targetMappings.nameToId).join(', ')}`,
    );
  }

  // 2. Run company search
  const inputs = buildCompanySearchInputs(filters);
  const searchResp = await clayFetch<RunEnrichmentResponse>(
    '/actions/run-enrichment',
    {
      method: 'POST',
      body: JSON.stringify({
        workspaceId: String(workspaceId),
        enrichmentType: 'find-lists-of-companies-with-mixrank-source-preview',
        options: { sync: true, returnTaskId: true, returnActionMetadata: true },
        inputs: { ...inputs, limit: limit ?? 50, result_count: true },
      }),
    },
  );

  const companies = (searchResp.result?.companies || []) as unknown as Array<
    Record<string, unknown>
  >;

  if (companies.length === 0) {
    return { recordsAdded: 0 };
  }

  // 3. Map search results to target table field IDs
  const records = companies.map((c) => {
    const cells: Record<string, unknown> = {};
    for (const fieldName of matchingFields) {
      const sourceKey = sourceKeyByName[fieldName];
      const targetFieldId = targetMappings.nameToId[fieldName];
      if (sourceKey && targetFieldId && c[sourceKey] != null) {
        cells[targetFieldId] = c[sourceKey];
      }
    }
    return { cells };
  });

  // 4. Insert records into target table
  await clayFetch<CreateRecordsResponse>(`/tables/${tableId}/records`, {
    method: 'POST',
    body: JSON.stringify({ records }),
  });

  return { recordsAdded: records.length };
}

// ============================================================================
// Field Management
// ============================================================================

/**
 * Create a field in a table.
 */

// ============================================================================
// Actions & Enrichment Catalog
// ============================================================================

/** All enrichment/action types the search endpoint accepts. */
const ENRICHMENT_SEARCH_TYPES = [
  'waterfall',
  'template',
  'action',
  'internal_action',
  'export_action',
  'signal_action',
  'client_driven_source_action',
  'source_action',
  'webhook_subscription_source',
  'function',
  'waterfall_template',
  'parent_waterfall_template',
] as const;

interface EnrichmentSearchResult {
  entity_id: string;
  name: string;
  type: string;
  score: number;
  tags: string | string[];
  packageName?: string;
  dataStrength?: string[];
  qualityScore?: number;
  packagePopularity?: number;
  matchingConcept?: string;
  outputPath?: string;
  supportedTableType?: string[];
}

interface EnrichmentSearchResponse {
  results: EnrichmentSearchResult[];
  searchId: string;
}

/**
 * Search for available enrichments/actions by keyword.
 * Returns matching enrichment options with metadata (provider, category, quality).
 * FREE operation - no credits consumed.
 */
export async function searchEnrichments(opts: {
  workspaceId: string;
  query: string;
  types?: string[];
}): Promise<{
  results: Array<{
    entityId: string;
    name: string;
    type: string;
    score: number;
    tags: string[];
    packageName?: string;
    dataStrength?: string[];
    qualityScore?: number;
    matchingConcept?: string;
    outputPath?: string;
  }>;
  searchId: string;
}> {
  const { workspaceId, query, types } = opts;

  if (!workspaceId)
    throw new Validation('searchEnrichments: workspaceId is required');
  if (!query && !(types && types.length > 0)) {
    throw new Validation(
      'searchEnrichments: query is required (or provide types to browse by category)',
    );
  }

  const searchTypes =
    types && types.length > 0 ? types : [...ENRICHMENT_SEARCH_TYPES];

  // Clay API requires non-empty userQuery; use a wildcard when browsing by type
  const userQuery = query ? query : 'import find search pull';

  const data = await clayFetch<EnrichmentSearchResponse>(
    `/enrichment-search/${workspaceId}/query`,
    {
      method: 'POST',
      body: JSON.stringify({
        userQuery,
        types: searchTypes,
      }),
    },
  );

  if (!data.results) {
    throw new ContractDrift('searchEnrichments: response missing results');
  }

  return {
    results: data.results.map((r) => ({
      entityId: r.entity_id,
      name: r.name,
      type: r.type,
      score: r.score,
      tags: Array.isArray(r.tags) ? r.tags : r.tags ? [r.tags] : [],
      ...(r.packageName != null && { packageName: r.packageName }),
      ...(r.dataStrength != null && { dataStrength: r.dataStrength }),
      ...(r.qualityScore != null && { qualityScore: r.qualityScore }),
      ...(r.matchingConcept != null && { matchingConcept: r.matchingConcept }),
      ...(r.outputPath != null && { outputPath: r.outputPath }),
    })),
    searchId: data.searchId,
  };
}

interface ActionDefinition {
  key: string;
  version: number;
  package?: {
    id: string;
    displayName: string;
  };
  displayName: string;
  inputParameterSchema?: Array<{
    name: string;
    displayName?: string;
    description?: string;
    type?: string;
    optional?: boolean;
    options?: Array<{ value: string; displayName: string }>;
    min?: number;
    max?: number;
    placeholderText?: string;
    typeSettings?: {
      type?: string;
      options?: Array<{ value: string; displayName: string }>;
      min?: number;
      max?: number;
      placeholderText?: string;
    };
    schemaVersion?: number;
  }>;
  outputParameterSchema?: Array<{
    name: string;
    type: string;
    displayName?: string;
  }>;
  auth?: { providerType: string };
}

/**
 * Get the input parameter schema for a specific action.
 * Uses GET /v3/actions?workspaceId={id} and filters by actionKey.
 * FREE operation - no credits consumed.
 */
export async function getActionInputs(
  opts: GetActionInputsInput,
): Promise<GetActionInputsOutput> {
  const { workspaceId, entityId } = opts;

  if (!workspaceId) throw new Validation('getActionInputs: workspaceId is required');
  if (!entityId) throw new Validation('getActionInputs: entityId is required');

  const slashIdx = entityId.indexOf('/');
  if (slashIdx === -1) {
    throw new Validation(
      `getActionInputs: entityId must be in "{actionPackageId}/{actionKey}" format, got "${entityId}"`,
    );
  }
  const targetPackageId = entityId.slice(0, slashIdx);
  const targetKey = entityId.slice(slashIdx + 1);

  const data = await clayFetch<{ actions: ActionDefinition[] }>(
    `/actions?workspaceId=${workspaceId}`,
  );

  if (!data.actions) {
    throw new ContractDrift('getActionInputs: response missing actions array');
  }

  const action = data.actions.find(
    (a) => a.key === targetKey && a.package?.id === targetPackageId,
  );

  if (!action) {
    throw new NotFound(
      `getActionInputs: action "${targetKey}" not found in package "${targetPackageId}". ` +
        `Found ${data.actions.length} total actions.`,
    );
  }

  const inputs = (action.inputParameterSchema ?? []).map((p) => {
    let fieldType = 'text';
    if (p.typeSettings?.type) fieldType = p.typeSettings.type;
    else if (p.type) fieldType = p.type;

    const options = p.typeSettings?.options ?? p.options;

    return {
      name: p.name,
      displayName: p.displayName ?? p.name,
      ...(p.description != null && { description: p.description }),
      type: fieldType,
      required: !p.optional,
      ...(options != null &&
        options.length > 0 && {
          options: options.map((o) => ({
            value: o.value,
            displayName: o.displayName,
          })),
        }),
      ...(p.typeSettings?.min != null && { min: p.typeSettings.min }),
      ...(p.typeSettings?.max != null && { max: p.typeSettings.max }),
      ...(p.min != null && { min: p.min }),
      ...(p.max != null && { max: p.max }),
      ...((p.typeSettings?.placeholderText ?? p.placeholderText) != null && {
        placeholder: p.typeSettings?.placeholderText ?? p.placeholderText,
      }),
    };
  });

  const outputs = (action.outputParameterSchema ?? []).map((o) => ({
    name: o.name,
    type: o.type,
    displayName: o.displayName ?? o.name,
  }));

  return {
    actionKey: action.key,
    packageName: action.package?.displayName || action.key.split('-')[0],
    displayName: action.displayName,
    version: action.version,
    authProvider: action.auth?.providerType || null,
    inputs,
    outputs,
  };
}

interface DynamicFieldResponse {
  parameterPath: string;
  dynamicData: Array<{
    value: string;
    displayName: string;
  }>;
}

/**
 * Resolve dynamic field options for actions with "dynamic-fields" or "dynamic-options-select" inputs.
 * Uses POST /v3/actions/dynamicFields to fetch options that depend on the connected account.
 * FREE operation - no credits consumed.
 */
export async function getDynamicFieldOptions(
  opts: GetDynamicFieldOptionsInput,
): Promise<GetDynamicFieldOptionsOutput> {
  const {
    actionPackageId,
    actionKey,
    authAccountId,
    parameterPath,
    currentInputs,
  } = opts;

  if (!actionPackageId)
    throw new Validation('getDynamicFieldOptions: actionPackageId is required');
  if (!actionKey)
    throw new Validation('getDynamicFieldOptions: actionKey is required');
  if (!authAccountId)
    throw new Validation('getDynamicFieldOptions: authAccountId is required');
  if (!parameterPath)
    throw new Validation('getDynamicFieldOptions: parameterPath is required');

  const request: Record<string, unknown> = {
    actionPackageId,
    actionKey,
    authAccountId,
    parameterPath,
    type: 'select',
  };

  if (currentInputs) {
    request.inputs = currentInputs;
  }

  const data = await clayFetch<DynamicFieldResponse[]>(
    '/actions/dynamicFields',
    {
      method: 'POST',
      body: JSON.stringify({ dynamicRequests: [request] }),
    },
  );

  if (!Array.isArray(data) || data.length === 0) {
    throw new ContractDrift(
      `getDynamicFieldOptions: no response for parameterPath "${parameterPath}"`,
    );
  }

  const result = data[0];

  return {
    parameterPath: result.parameterPath,
    options: (result.dynamicData || []).map((o) => ({
      value: String(o.value),
      displayName: o.displayName,
    })),
  };
}

interface EnrichmentFieldResponse {
  field: {
    id: string;
    tableId: string;
    type: string;
    name: string;
    typeSettings?: Record<string, unknown>;
    settingsError?: Array<{ type: string; message: string }>;
    inputFieldIds?: string[];
    createdAt: string;
    updatedAt: string;
  };
}

/**
 * Add a specific enrichment provider as a column on a table.
 * Creates an action field with the enrichment's actionKey/actionPackageId
 * and binds table fields to the enrichment's input parameters.
 *
 * Uses POST /tables/{tableId}/fields with type "action".
 * The enrichment runs per-row when triggered via runEnrichmentColumn().
 */
export async function addEnrichmentColumn(
  opts: AddEnrichmentColumnInput,
): Promise<AddEnrichmentColumnOutput> {
  const { tableId, entityId, inputMappings, columnName, authAccountId } = opts;

  if (!tableId) {
    throw new Validation('addEnrichmentColumn: tableId is required');
  }
  if (!entityId) {
    throw new Validation('addEnrichmentColumn: entityId is required');
  }

  // Parse entityId format: "{actionPackageId}/{actionKey}"
  const slashIdx = entityId.indexOf('/');
  if (slashIdx === -1) {
    throw new Validation(
      `addEnrichmentColumn: entityId must be in "{actionPackageId}/{actionKey}" format. Got: "${entityId}". ` +
        `Use searchEnrichments() to get valid entityIds.`,
    );
  }
  const actionPackageId = entityId.slice(0, slashIdx);
  const actionKey = entityId.slice(slashIdx + 1);

  // Build inputsBinding from mappings
  const inputsBinding = (inputMappings || []).map((m) => ({
    name: m.inputName,
    formulaText: `{{${m.fieldId}}}`,
  }));

  const body: Record<string, unknown> = {
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
      ...(authAccountId && { authAccountId }),
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
