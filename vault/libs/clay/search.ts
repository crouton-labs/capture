/**
 * Search operations
 */

import { Validation } from '@vallum/_runtime';
import {
  clayFetch,
  type MeResponse,
  type RunEnrichmentResponse,
} from './shared';
import type {
  PeopleSearchFilters,
  CompanySearchFilters,
  SearchPeopleOutput,
  SearchCompaniesOutput,
  GetRelatedKeywordsOutput,
  GetSavedSearchesOutput,
  GetPeopleSearchLimitOutput,
  CreateSavedSearchOutput,
  UpdateSavedSearchInput,
  UpdateSavedSearchOutput,
  DeleteSavedSearchOutput,
} from './schemas';

// Private helper functions
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
    names: filters.names ?? [],
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

interface RelatedKeywordsResponse {
  relatedKeywords: string[];
}

/**
 * Get related/suggested keywords for search refinement.
 * Helps expand searches by suggesting related terms.
 */
export async function getRelatedKeywords(opts: {
  keywords: string[];
}): Promise<GetRelatedKeywordsOutput> {
  const { keywords } = opts;

  if (!keywords || keywords.length === 0) {
    throw new Validation('At least one keyword is required');
  }

  const data = await clayFetch<RelatedKeywordsResponse>(
    '/search/related-keywords',
    {
      method: 'POST',
      body: JSON.stringify({ keywords }),
    },
  );

  return {
    relatedKeywords: data.relatedKeywords || [],
  };
}

interface PresetResponse {
  id: string;
  name: string;
  type: string;
  description?: string | null;
  actionKey: string;
  actionPackageId: string;
  preset?: {
    type: string;
    inputsBinding?: Record<string, unknown>;
    inputDefinitions?: Array<{
      label: string;
      inputId: string;
      semanticType: string;
    }>;
    conditionalRunFormulaText?: string;
    aiSummary?: string;
  };
  workspaceId?: number | null;
  createdByUserId?: number | null;
  category?: string | null;
  isPublic?: boolean;
  isPopular?: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

/**
 * List saved search presets in a workspace.
 * Filters the full preset list (300+) to only search-related presets.
 */
export async function getSavedSearches(opts: {
  workspaceId: string;
}): Promise<GetSavedSearchesOutput> {
  const { workspaceId } = opts;

  if (!workspaceId) {
    throw new Validation('workspaceId is required');
  }

  const data = await clayFetch<PresetResponse[]>(
    `/presets/workspace/${workspaceId}`,
  );

  // Filter to search-related presets only (people/company/business finding operations).
  // The API returns ALL workspace presets (enrichments, claygents, HTTP actions, etc., 400+),
  // so we filter by actionKey to return only search operations.
  // Includes: user-created saved searches (evaluated_source), recent searches (recent_search),
  // and built-in templates (action).
  const savedSearches = (data || [])
    .filter(
      (p) =>
        p.actionKey &&
        (p.actionKey.startsWith('find-lists-of-people') ||
          p.actionKey.startsWith('find-lists-of-companies') ||
          p.actionKey === 'find-businesses'),
    )
    .map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      description: p.description,
      actionKey: p.actionKey,
      actionPackageId: p.actionPackageId,
      preset: p.preset
        ? {
            type: p.preset.type,
            inputsBinding: p.preset.inputsBinding,
            inputDefinitions: p.preset.inputDefinitions,
            conditionalRunFormulaText: p.preset.conditionalRunFormulaText,
            aiSummary: p.preset.aiSummary,
          }
        : undefined,
      workspaceId: p.workspaceId,
      createdByUserId: p.createdByUserId,
      category: p.category,
      isPublic: p.isPublic,
      isPopular: p.isPopular,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      deletedAt: p.deletedAt,
    }));

  return {
    savedSearches,
    totalCount: savedSearches.length,
  };
}

interface PeopleSearchLimitResponse {
  peopleSearchLimit: number;
}

/**
 * Get the people search result limit for a workspace.
 * This limit varies by billing plan.
 */
export async function getPeopleSearchLimit(opts: {
  workspaceId: string;
}): Promise<GetPeopleSearchLimitOutput> {
  const { workspaceId } = opts;

  if (!workspaceId) {
    throw new Validation('workspaceId is required');
  }

  const data = await clayFetch<PeopleSearchLimitResponse>(
    `/workspaces/${workspaceId}/peopleSearchLimit`,
  );

  return {
    peopleSearchLimit: data.peopleSearchLimit,
  };
}

/**
 * Preview people search with filters.
 * **FREE operation** - This is a preview search that does not consume credits.
 * Returns up to 50 people matching the filters.
 */
export async function searchPeople(opts: {
  workspaceId: string;
  filters?: PeopleSearchFilters;
  limit?: number;
}): Promise<SearchPeopleOutput> {
  const { workspaceId, filters = {} as PeopleSearchFilters, limit = 50 } = opts;

  if (!workspaceId) {
    throw new Validation('workspaceId is required');
  }

  if (
    filters.job_title_mode &&
    filters.job_title_mode !== 'smart' &&
    filters.job_title_mode !== 'exact'
  ) {
    throw new Validation(
      `searchPeople: invalid job_title_mode "${filters.job_title_mode}"; must be "smart" or "exact"`,
    );
  }

  const inputs = {
    ...buildSearchInputs(filters),
    limit: Math.min(Math.max(limit, 1), 50),
    result_count: true,
  };

  const payload = {
    workspaceId: String(workspaceId),
    enrichmentType: 'find-lists-of-people-with-mixrank-source-preview',
    options: {
      sync: true,
      returnTaskId: true,
      returnActionMetadata: true,
    },
    inputs,
  };

  const data = await clayFetch<RunEnrichmentResponse>(
    '/actions/run-enrichment',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );

  const people = (data.result?.people || []).map((p) => ({
    profile_id: p.profile_id,
    name: p.name,
    first_name: p.first_name,
    last_name: p.last_name,
    url: p.url,
    latest_experience_company: p.latest_experience_company,
    latest_experience_title: p.latest_experience_title,
    latest_experience_start_date: p.latest_experience_start_date,
    location_name: p.location_name,
    domain: p.domain,
    company_first_slug: p.company_first_slug,
  }));

  return {
    people,
    totalCount: people.length,
    resultCount: data.result?.peopleCount ?? data.result?.result_count,
    taskId: data.metadata?.taskId ?? data.taskId,
  };
}

/**
 * Preview company search with filters.
 * **FREE operation** - This is a preview search that does not consume credits.
 * Returns up to 50 companies matching the filters.
 */
export async function searchCompanies(opts: {
  workspaceId: string;
  filters?: CompanySearchFilters;
  limit?: number;
}): Promise<SearchCompaniesOutput> {
  const {
    workspaceId,
    filters = {} as CompanySearchFilters,
    limit = 50,
  } = opts;

  if (!workspaceId) {
    throw new Validation('workspaceId is required');
  }

  if (limit < 1 || limit > 50) {
    throw new Validation(
      `searchCompanies: limit must be between 1 and 50, got ${limit}`,
    );
  }

  const inputs = {
    ...buildCompanySearchInputs(filters),
    limit,
    result_count: true,
  };

  const payload = {
    workspaceId: String(workspaceId),
    enrichmentType: 'find-lists-of-companies-with-mixrank-source-preview',
    options: {
      sync: true,
      returnTaskId: true,
      returnActionMetadata: true,
    },
    inputs,
  };

  const data = await clayFetch<RunEnrichmentResponse>(
    '/actions/run-enrichment',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );

  const companies = (data.result?.companies || []).map((c) => ({
    clay_company_id: String(c.clay_company_id),
    linkedin_company_id: c.linkedin_company_id
      ? String(c.linkedin_company_id)
      : undefined,
    name: c.name,
    type: c.type,
    size: c.size,
    industry: c.industry,
    industries: c.industries,
    country: c.country,
    location: c.location,
    domain: c.domain,
    linkedin_url: c.linkedin_url,
    description: c.description,
    total_funding_amount_range_usd: c.total_funding_amount_range_usd,
    annual_revenue: c.annual_revenue,
    derived_datapoints: c.derived_datapoints ?? undefined,
  }));

  return {
    companies,
    totalCount: companies.length,
    resultCount: data.result?.companyCount,
    taskId: data.metadata?.taskId ?? data.taskId,
  };
}

const VALID_SENIORITY_LEVELS = [
  'owner',
  'partner',
  'c-suite',
  'vp',
  'director',
  'head',
  'manager',
  'senior',
  'entry',
  'assistant',
  'intern',
  'freelance',
  'certified',
] as const;

const VALID_REGIONS = ['NAM', 'LATAM', 'EMEA', 'APAC'] as const;

const VALID_JOB_FUNCTIONS = [
  'Clerical and Administrative',
  'Agriculture, Horticulture, and the Outdoors',
  'Design, Media, and Writing',
  'Business Management and Operations',
  'Community and Social Services',
  'Construction, Extraction, and Architecture',
  'Customer and Client Support',
  'Education and Training',
  'Engineering',
  'Finance',
  'Healthcare',
  'Hospitality, Food, and Tourism',
  'Human Resources',
  'Information Technology and Computer Science',
  'Law, Compliance, and Public Safety',
  'Maintenance, Repair, and Installation',
  'Manufacturing and Production',
  'Marketing and Public Relations',
  'Military',
  'Performing Arts',
  'Personal Services',
  'Sales',
  'Science and Research',
  'Social Analysis and Planning',
  'Students',
  'Transportation',
  'Not Employed',
] as const;

export function validatePeopleSearchFilters(
  filters: PeopleSearchFilters,
): void {
  if (
    filters.job_title_mode &&
    filters.job_title_mode !== 'smart' &&
    filters.job_title_mode !== 'exact'
  ) {
    throw new Validation(
      `invalid job_title_mode "${filters.job_title_mode}"; must be "smart" or "exact"`,
    );
  }

  if (filters.job_title_seniority_levels?.length) {
    const invalid = filters.job_title_seniority_levels.filter(
      (s) =>
        !VALID_SENIORITY_LEVELS.includes(
          s as (typeof VALID_SENIORITY_LEVELS)[number],
        ),
    );
    if (invalid.length) {
      throw new Validation(
        `invalid seniority levels: ${JSON.stringify(invalid)}; valid values: ${VALID_SENIORITY_LEVELS.join(', ')}`,
      );
    }
  }

  if (filters.location_regions_include?.length) {
    const invalid = filters.location_regions_include.filter(
      (r) => !VALID_REGIONS.includes(r as (typeof VALID_REGIONS)[number]),
    );
    if (invalid.length) {
      throw new Validation(
        `invalid regions in location_regions_include: ${JSON.stringify(invalid)}; valid values: ${VALID_REGIONS.join(', ')}`,
      );
    }
  }

  if (filters.location_regions_exclude?.length) {
    const invalid = filters.location_regions_exclude.filter(
      (r) => !VALID_REGIONS.includes(r as (typeof VALID_REGIONS)[number]),
    );
    if (invalid.length) {
      throw new Validation(
        `invalid regions in location_regions_exclude: ${JSON.stringify(invalid)}; valid values: ${VALID_REGIONS.join(', ')}`,
      );
    }
  }

  if (filters.job_functions?.length) {
    const invalid = filters.job_functions.filter(
      (f) =>
        !VALID_JOB_FUNCTIONS.includes(
          f as (typeof VALID_JOB_FUNCTIONS)[number],
        ),
    );
    if (invalid.length) {
      throw new Validation(
        `invalid job functions: ${JSON.stringify(invalid)}; valid values: ${VALID_JOB_FUNCTIONS.join(', ')}`,
      );
    }
  }

  // Validate count fields are non-negative
  const countFields = [
    'connection_count',
    'max_connection_count',
    'follower_count',
    'max_follower_count',
    'experience_count',
    'max_experience_count',
  ] as const;
  for (const field of countFields) {
    const val = filters[field];
    if (val !== undefined && val !== null && val < 0) {
      throw new Validation(`${field} must be non-negative, got ${val}`);
    }
  }

  const monthFields = [
    'current_role_min_months_since_start_date',
    'current_role_max_months_since_start_date',
  ] as const;
  for (const field of monthFields) {
    const val = filters[field];
    if (val !== undefined && val !== null && val < 0) {
      throw new Validation(`${field} must be non-negative, got ${val}`);
    }
  }
}

export async function createSavedSearch(opts: {
  workspaceId: string;
  name: string;
  description?: string;
  filters: PeopleSearchFilters;
}): Promise<CreateSavedSearchOutput> {
  const { workspaceId, name, description, filters } = opts;

  if (!workspaceId) {
    throw new Validation('createSavedSearch: workspaceId is required');
  }
  if (!name) {
    throw new Validation('createSavedSearch: name is required');
  }
  if (!filters) {
    throw new Validation('createSavedSearch: filters is required');
  }

  validatePeopleSearchFilters(filters);

  // Get current user ID (required for creating presets)
  const userData = await clayFetch<MeResponse>('/me');
  const userId = String(userData.id);

  // Build inputsBinding from all user-provided filters.
  // Use buildSearchInputs to get the full field set with correct defaults,
  // then strip out empty/default values so only meaningful filters are saved.
  const allInputs = buildSearchInputs(filters);
  const inputsBinding: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(allInputs)) {
    // Skip internal fields not relevant to saved search presets
    if (
      [
        'company_record_id',
        'company_table_id',
        'exclude_entities_configuration',
        'exclude_entities_bitmap',
        'exclude_entity_bitmap',
        'exclude_people_identifiers_mixed',
        'previous_entities_bitmap',
        'role_range_end_month',
        'role_range_start_month',
        'start_from_method',
        'limit',
        'result_count',
      ].includes(key)
    ) {
      continue;
    }
    // Skip empty/default values
    if (value === null || value === undefined) continue;
    if (value === '') continue;
    if (value === false) continue;
    if (Array.isArray(value)) {
      // Filter out empty strings from arrays
      const filtered = value.filter((v) => v !== '');
      if (filtered.length === 0) continue;
      inputsBinding[key] = filtered;
      continue;
    }
    inputsBinding[key] = value;
  }

  const payload = {
    actionKey: 'find-lists-of-people-with-mixrank-source',
    actionPackageId: 'e251a70e-46d7-4f3a-b3ef-a211ad3d8bd2',
    createdByUserId: userId,
    description: description !== undefined ? description : '',
    name,
    preset: {
      type: 'evaluated_source',
      inputsBinding,
    },
    workspaceId: String(workspaceId),
  };

  const data = await clayFetch<PresetResponse>('/presets', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  return {
    id: data.id,
    name: data.name,
    type: data.type,
    description: data.description,
    actionKey: data.actionKey,
    actionPackageId: data.actionPackageId,
    preset: data.preset
      ? {
          type: data.preset.type,
          inputsBinding: data.preset.inputsBinding,
          aiSummary: data.preset.aiSummary,
        }
      : undefined,
    workspaceId: data.workspaceId,
    createdByUserId: data.createdByUserId,
    category: data.category,
    isPublic: data.isPublic,
    isPopular: data.isPopular,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    deletedAt: data.deletedAt,
  };
}

/**
 * Update a saved search preset's name, description, or filters.
 */
export async function updateSavedSearch(
  opts: UpdateSavedSearchInput,
): Promise<UpdateSavedSearchOutput> {
  const { presetId, name, description, filters } = opts;

  if (!presetId) {
    throw new Validation('updateSavedSearch: presetId is required');
  }
  if (
    name === undefined &&
    description === undefined &&
    filters === undefined
  ) {
    throw new Validation(
      'updateSavedSearch: at least one of name, description, or filters must be provided',
    );
  }

  if (filters) {
    validatePeopleSearchFilters(filters);
  }

  const payload: Record<string, unknown> = {};
  if (name !== undefined) payload.name = name;
  if (description !== undefined) payload.description = description;

  if (filters) {
    const allInputs = buildSearchInputs(filters);
    const inputsBinding: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(allInputs)) {
      if (
        [
          'company_record_id',
          'company_table_id',
          'exclude_entities_configuration',
          'exclude_entities_bitmap',
          'exclude_entity_bitmap',
          'exclude_people_identifiers_mixed',
          'previous_entities_bitmap',
          'role_range_end_month',
          'role_range_start_month',
          'start_from_method',
          'limit',
          'result_count',
        ].includes(key)
      ) {
        continue;
      }
      if (value === null || value === undefined) continue;
      if (value === '') continue;
      if (value === false) continue;
      if (Array.isArray(value)) {
        const filtered = value.filter((v) => v !== '');
        if (filtered.length === 0) continue;
        inputsBinding[key] = filtered;
        continue;
      }
      inputsBinding[key] = value;
    }
    payload.preset = { type: 'evaluated_source', inputsBinding };
  }

  const data = await clayFetch<PresetResponse>(`/presets/${presetId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });

  return {
    id: data.id,
    name: data.name,
    type: data.type,
    description: data.description,
    actionKey: data.actionKey,
    actionPackageId: data.actionPackageId,
    preset: data.preset
      ? {
          type: data.preset.type,
          inputsBinding: data.preset.inputsBinding,
          aiSummary: data.preset.aiSummary,
        }
      : undefined,
    workspaceId: data.workspaceId,
    createdByUserId: data.createdByUserId,
    category: data.category,
    isPublic: data.isPublic,
    isPopular: data.isPopular,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    deletedAt: data.deletedAt,
  };
}

/**
 * Delete a saved search preset.
 * Permanently removes a saved search configuration.
 */
export async function deleteSavedSearch(opts: {
  presetId: string;
}): Promise<DeleteSavedSearchOutput> {
  const { presetId } = opts;

  if (!presetId) {
    throw new Validation('deleteSavedSearch: presetId is required');
  }

  await clayFetch(`/presets/${presetId}`, {
    method: 'DELETE',
  });

  return {
    success: true,
  };
}
