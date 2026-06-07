/**
 * Apollo Discovery Module
 * Saved searches, credit-costing operations (email/phone unlock),
 * filter discovery, and plan details.
 */

import { ContractDrift, NotFound, Validation, throwForStatus } from '@vallum/_runtime';

import type {
  GetSavedSearchesOutput,
  CreateSavedSearchOutput,
  UpdateSavedSearchOutput,
  UnlockEmailOutput,
  UnlockPhoneOutput,
  GetFilterOptionsOutput,
  GetFilterFieldsOutput,
  SearchFilterTagsOutput,
  GetPlanDetailsOutput,
} from '../schemas';

// ============================================================================
// Saved Searches
// ============================================================================

/**
 * Get saved searches (finder views) in Apollo.
 * Returns user and team saved searches.
 */
export async function getSavedSearches(
  opts: {
    page?: number;
    perPage?: number;
    sortByField?: string;
    sortAscending?: boolean;
  } = {},
): Promise<GetSavedSearchesOutput> {
  const {
    page = 1,
    perPage = 50,
    sortByField = 'updated_at',
    sortAscending = false,
  } = opts;

  const base = window.location.origin;
  const response = await fetch(`${base}/api/v1/finder_views/people/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      page: page,
      per_page: perPage,
      sort_by_field: sortByField,
      sort_ascending: sortAscending,
      cacheKey: Date.now(),
    }),
  });

  const data = await response.json();

  // Separate system vs custom views
  const finderViews = data.finder_views || [];
  const customViews = finderViews.filter((v: { system: boolean }) => !v.system);
  const systemViews = finderViews.filter((v: { system: boolean }) => v.system);

  return {
    finderViews: finderViews,
    customViews: customViews,
    systemViews: systemViews,
    pagination: data.pagination,
  };
}

/**
 * Create a saved search (finder view) in Apollo.
 * Saves search filters for quick access later.
 */
export async function createSavedSearch(opts: {
  name: string;
  modality?: 'people' | 'companies';
  signals?: Record<string, unknown>;
}): Promise<CreateSavedSearchOutput> {
  const { name, modality = 'people', signals = {} } = opts;

  if (!name) {
    throw new Validation('Saved search name is required');
  }

  const base = window.location.origin;
  const response = await fetch(`${base}/api/v1/finder_views`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      name,
      modality,
      signals,
    }),
  });

  const data = await response.json();
  const view = data.finder_view;

  if (!view) {
    if (data.error) {
      throw new ContractDrift(data.error);
    }
    throw new ContractDrift('Failed to create saved search');
  }

  return {
    id: view.id,
    name: view.name,
    modality: view.modality,
    signals: view.signals,
  };
}

/**
 * Update a saved search (finder view) in Apollo.
 * Can rename or update the filters.
 */
export async function updateSavedSearch(opts: {
  id: string;
  name?: string;
  signals?: Record<string, unknown>;
}): Promise<UpdateSavedSearchOutput> {
  const { id, name, signals } = opts;

  if (!id) throw new Validation('id is required');

  const base = window.location.origin;

  // Fetch current saved search; Apollo PUT requires the full object
  const getResponse = await fetch(`${base}/api/v1/finder_views/${id}`, {
    credentials: 'include',
  });
  if (!getResponse.ok)
    throwForStatus(getResponse.status, await getResponse.text().catch(() => undefined));

  const getData = await getResponse.json();
  const existing = getData.finder_view;
  if (!existing) throw new NotFound('updateSavedSearch: saved search not found');

  // Merge updates into the full object
  if (name !== undefined) existing.name = name;
  if (signals !== undefined) existing.signals = signals;

  const response = await fetch(`${base}/api/v1/finder_views/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(existing),
  });

  if (!response.ok)
    throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();
  const view = data.finder_view;

  if (!view) throw new ContractDrift('updateSavedSearch: no finder_view in response');

  return {
    id: view.id,
    name: view.name,
    modality: view.modality,
    signals: view.signals,
  };
}

// ============================================================================
// Credit-Costing Operations (Email/Phone Unlock)
// ============================================================================

interface AddToProspectsResponse {
  contacts?: Array<{
    id: string;
    name?: string;
    title?: string;
    organization_name?: string;
    email?: string;
    email_status?: string;
    contact_emails?: Array<{ email: string; email_status: string }>;
    phone_numbers?: Array<{
      raw_number: string;
      sanitized_number?: string;
      type?: string;
      status?: string;
    }>;
    sanitized_phone?: string;
    direct_dial_status?: string;
  }>;
  error?: string;
}

/**
 * Save a person to your CRM and reveal their email address.
 * The basic call is free (no credits). Saves the person as a contact
 * and returns whatever email Apollo already has in its database.
 *
 * Set useWaterfall=true to run waterfall enrichment for harder-to-find
 * emails via 3rd-party providers (costs 1 credit).
 */
export async function unlockEmail(opts: {
  personId: string;
  useWaterfall?: boolean;
  listName?: string;
}): Promise<UnlockEmailOutput> {
  const { personId, useWaterfall = false, listName } = opts;

  if (!personId) {
    throw new Validation('personId is required');
  }

  const base = window.location.origin;
  const body: Record<string, unknown> = {
    entity_ids: [personId],
    analytics_context: 'Searcher',
  };

  if (useWaterfall) {
    body.runContactEmailsWaterfall = true;
    body.uiDynamicFieldRequestId = crypto.randomUUID();
    body.waterfallCreditChargeConsent = true;
  }

  if (listName) {
    body.label_names = [listName];
  }

  const response = await fetch(
    `${base}/api/v1/mixed_people/add_to_my_prospects`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    },
  );

  if (response.status === 422) {
    const errBody = await response.json();
    if (errBody?.code === 'credit_limit') {
      const remaining =
        (errBody as { num_credits_remaining?: number }).num_credits_remaining ??
        0;
      return {
        success: false,
        error: `Insufficient credits (have ${remaining}). Add credits in Apollo settings.`,
      };
    }
    return {
      success: false,
      error: errBody?.error || errBody?.message || `Apollo returned 422`,
    };
  }

  const payload: AddToProspectsResponse = await response.json();

  if (payload.contacts && payload.contacts.length > 0) {
    const contact = payload.contacts[0];
    return {
      success: true,
      contact: {
        id: contact.id,
        name: contact.name,
        title: contact.title,
        company: contact.organization_name,
        email: contact.email,
        emailStatus: contact.email_status,
        contactEmails: contact.contact_emails,
      },
    };
  }

  if (payload.error) {
    return {
      success: false,
      error: payload.error,
    };
  }

  return {
    success: false,
    error: `No contact returned for personId "${personId}". This usually means you passed a Contact ID instead of a Person ID. unlockEmail requires Person IDs from selectPeople/searchPeople, not Contact IDs from CSV imports or getContactsInList.`,
  };
}

/**
 * Save a person to your CRM and reveal their phone number.
 * The basic call is free (no credits). Saves the person as a contact
 * and returns any phone numbers Apollo already has.
 *
 * Set useEnrichment=true to run direct dial enrichment for finding
 * direct phone numbers via 3rd-party providers (costs 8 credits).
 */
export async function unlockPhone(opts: {
  personId: string;
  useEnrichment?: boolean;
  listName?: string;
}): Promise<UnlockPhoneOutput> {
  const { personId, useEnrichment = false, listName } = opts;

  if (!personId) {
    throw new Validation('personId is required');
  }

  const base = window.location.origin;
  const body: Record<string, unknown> = {
    entity_ids: [personId],
    analytics_context: 'Searcher',
  };

  if (useEnrichment) {
    body.runDirectDialEnrichment = true;
    body.uiDynamicFieldRequestId = crypto.randomUUID();
    body.waterfallCreditChargeConsent = true;
  }

  if (listName) {
    body.label_names = [listName];
  }

  const response = await fetch(
    `${base}/api/v1/mixed_people/add_to_my_prospects`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    },
  );

  if (response.status === 422) {
    const errBody = await response.json();
    if (errBody?.code === 'credit_limit') {
      const remaining =
        (errBody as { num_credits_remaining?: number }).num_credits_remaining ??
        0;
      return {
        success: false,
        error: `Insufficient credits (have ${remaining}). Add credits in Apollo settings.`,
      };
    }
    return {
      success: false,
      error: errBody?.error || errBody?.message || `Apollo returned 422`,
    };
  }

  const payload: AddToProspectsResponse = await response.json();

  if (payload.contacts && payload.contacts.length > 0) {
    const contact = payload.contacts[0];
    return {
      success: true,
      contact: {
        id: contact.id,
        name: contact.name,
        title: contact.title,
        company: contact.organization_name,
        email: contact.email,
        emailStatus: contact.email_status,
        contactEmails: contact.contact_emails,
        phoneNumbers: contact.phone_numbers,
        sanitizedPhone: contact.sanitized_phone,
        directDialStatus: contact.direct_dial_status,
      },
    };
  }

  if (payload.error) {
    return {
      success: false,
      error: payload.error,
    };
  }

  return {
    success: false,
    error: `No contact returned for personId "${personId}". This usually means you passed a Contact ID instead of a Person ID. unlockPhone requires Person IDs from selectPeople/searchPeople, not Contact IDs from CSV imports or getContactsInList.`,
  };
}

// ============================================================================
// Filter Discovery
// ============================================================================

interface BootstrappedFacet {
  value: string;
  display_name: string;
  count?: number;
  category?: string;
  tooltip?: string;
}

interface BootstrappedSubdepartment {
  value: string;
  label: string;
  level: number;
  parent?: string;
}

/** Map from facet group name to the filter parameter key agents should use */
const FACET_TO_FILTER_KEY: Record<string, string> = {
  latest_funding_stage_facets: 'organization_latest_funding_stage_cd',
  person_seniority_facets: 'person_seniorities',
  num_employees_facets: 'organization_num_employees_ranges',
  organization_revenue_facets: 'revenue_range',
  linkedin_industry_facets: 'organization_linkedin_industry_tag_ids',
  contact_stage_facets: 'contact_stage_ids',
  account_stage_facets: 'account_stage_ids',
  forecast_category_facets: 'forecast_category',
  organization_trading_status_facets: 'organization_trading_status',
  organization_intent_scoring_facets: 'intent_strengths',
  prospected_by_current_team_facets: 'prospected_by_current_team',
  person_persona_facets: 'q_person_persona_ids',
};

/**
 * Get all available filter facets with their valid values.
 * Returns funding stages, seniorities, employee ranges, revenue ranges, industries, and more.
 */
export async function getFilterOptions(): Promise<GetFilterOptionsOutput> {
  try {
    const base = window.location.origin;
    const response = await fetch(
      `${base}/api/v1/auth/additional_bootstrapped_data?mobile=false`,
      { credentials: 'include' },
    );
    const data = await response.json();
    const facets = data.bootstrapped_data?.default_finder_facets;

    if (!facets) {
      return {
        success: false,
        facets: [],
        error: 'No facet data found. User may not be logged in.',
      };
    }

    const result = Object.entries(facets)
      .filter(
        ([, values]) =>
          Array.isArray(values) && (values as BootstrappedFacet[]).length > 0,
      )
      .map(([name, values]) => ({
        name,
        filterKey: FACET_TO_FILTER_KEY[name] || name.replace(/_facets$/, ''),
        options: (values as BootstrappedFacet[]).map((f) => ({
          value: f.value,
          displayName: f.display_name,
          ...(f.count !== undefined ? { count: f.count } : {}),
          ...(f.category ? { category: f.category } : {}),
        })),
      }));

    // Add departments as a facet group from subdepartments data
    const subdepartments: BootstrappedSubdepartment[] =
      data.bootstrapped_data?.subdepartments || [];
    if (subdepartments.length > 0) {
      result.push({
        name: 'department_facets',
        filterKey: 'person_department_or_subdepartments',
        options: subdepartments.map((d) => ({
          value: d.value,
          displayName: d.label + (d.level === 0 ? ' (top-level)' : ''),
          ...(d.parent ? { category: d.parent } : {}),
        })),
      });
    }

    // Static filter options not in bootstrapped data but available in search sidebar
    result.push(
      {
        name: 'email_status_facets',
        filterKey: 'contact_email_status',
        options: [
          { value: 'verified', displayName: 'Verified' },
          { value: 'guessed', displayName: 'Guessed' },
          { value: 'unavailable', displayName: 'Unavailable' },
          { value: 'bounced', displayName: 'Bounced' },
        ],
      },
      {
        name: 'phone_type_facets',
        filterKey: 'phone_number_types',
        options: [
          { value: 'mobile', displayName: 'Mobile' },
          { value: 'work_direct', displayName: 'Work - Direct' },
          { value: 'work_hq', displayName: 'Corporate Phone' },
          { value: 'home', displayName: 'Home' },
          { value: 'other', displayName: 'Other' },
          { value: 'work_hq_account', displayName: 'Work HQ (Account)' },
        ],
      },
      {
        name: 'phone_status_facets',
        filterKey: 'phone_number_statuses',
        options: [
          { value: 'no_status', displayName: 'No Status' },
          { value: 'validated', displayName: 'Verified' },
          { value: 'not_validated', displayName: 'Unverified' },
          { value: 'questionable', displayName: 'Questionable' },
          { value: 'invalid', displayName: 'Invalid' },
        ],
      },
      {
        name: 'job_function_facets',
        filterKey: 'person_functions',
        options: [
          { value: 'sales', displayName: 'Sales' },
          { value: 'marketing', displayName: 'Marketing' },
          { value: 'engineering', displayName: 'Engineering' },
          { value: 'finance', displayName: 'Finance' },
          { value: 'human_resources', displayName: 'Human Resources' },
          { value: 'operations', displayName: 'Operations' },
          {
            value: 'information_technology',
            displayName: 'Information Technology',
          },
          { value: 'legal', displayName: 'Legal' },
          { value: 'consulting', displayName: 'Consulting' },
          { value: 'education', displayName: 'Education' },
          { value: 'medical_health', displayName: 'Medical & Health' },
          { value: 'support', displayName: 'Support' },
          { value: 'design', displayName: 'Design' },
          {
            value: 'media_communications',
            displayName: 'Media & Communications',
          },
          { value: 'product_management', displayName: 'Product Management' },
          { value: 'arts_design', displayName: 'Arts & Design' },
          { value: 'administrative', displayName: 'Administrative' },
          { value: 'accounting', displayName: 'Accounting' },
        ],
      },
      {
        name: 'market_segment_facets',
        filterKey: 'market_segments',
        options: [
          { value: 'smb', displayName: 'SMB' },
          { value: 'mid_market', displayName: 'Mid-Market' },
          { value: 'enterprise', displayName: 'Enterprise' },
        ],
      },
      {
        name: 'has_phone_facets',
        filterKey: 'has_phone',
        options: [
          { value: 'true', displayName: 'Has Phone Number' },
          { value: 'false', displayName: 'No Phone Number' },
        ],
      },
      {
        name: 'has_email_facets',
        filterKey: 'has_email',
        options: [
          { value: 'true', displayName: 'Has Email' },
          { value: 'false', displayName: 'No Email' },
        ],
      },
    );

    // Dynamic filter options from bootstrapped data (account-specific)
    const phoneOutcomes = data.bootstrapped_data?.phone_call_outcomes;
    if (Array.isArray(phoneOutcomes) && phoneOutcomes.length > 0) {
      result.push({
        name: 'phone_call_outcome_facets',
        filterKey: 'phone_call_outcome_ids',
        options: phoneOutcomes.map((o: { id: string; name: string }) => ({
          value: o.id,
          displayName: o.name,
        })),
      });
    }

    const phoneCallPurposes = data.bootstrapped_data?.phone_call_purposes;
    if (Array.isArray(phoneCallPurposes) && phoneCallPurposes.length > 0) {
      result.push({
        name: 'phone_call_purpose_facets',
        filterKey: 'phone_call_purpose_ids',
        options: phoneCallPurposes.map((p: { id: string; name: string }) => ({
          value: p.id,
          displayName: p.name,
        })),
      });
    }

    return { success: true, facets: result };
  } catch (err) {
    return {
      success: false,
      facets: [],
      error: (err as Error).message,
    };
  }
}

/**
 * Get all valid filter parameter names with human-readable labels.
 * Use this to discover what filter keys to pass to searchPeople/searchCompanies.
 */
export async function getFilterFields(opts: {
  search?: string;
}): Promise<GetFilterFieldsOutput> {
  const { search } = opts;

  try {
    const base = window.location.origin;
    const response = await fetch(
      `${base}/api/v1/auth/additional_bootstrapped_data?mobile=false`,
      { credentials: 'include' },
    );
    const data = await response.json();
    const signalNames: Record<string, string> =
      data.bootstrapped_data?.readable_signal_names;

    if (!signalNames) {
      return {
        success: false,
        fields: [],
        totalCount: 0,
        error: 'No filter field data found. User may not be logged in.',
      };
    }

    let fields = Object.entries(signalNames).map(([key, label]) => ({
      key,
      label: typeof label === 'string' ? label : key,
    }));

    const totalCount = fields.length;

    if (search) {
      const q = search.toLowerCase();
      fields = fields.filter(
        (f) =>
          f.key.toLowerCase().includes(q) || f.label.toLowerCase().includes(q),
      );
    }

    return { success: true, fields, totalCount };
  } catch (err) {
    return {
      success: false,
      fields: [],
      totalCount: 0,
      error: (err as Error).message,
    };
  }
}

/**
 * Search for filter tags (industries or technologies) by name.
 * Returns IDs needed for filtering in searchPeople/searchCompanies.
 *
 * Apollo's tags/search API ignores the q parameter, so we fetch all tags
 * and filter client-side. Industries (~148 total) are fetched completely.
 * Technologies (~2,300 total) are fetched completely via auto-pagination.
 */
export async function searchFilterTags(opts: {
  kind: 'linkedin_industry' | 'technology';
  query: string;
}): Promise<SearchFilterTagsOutput> {
  const { kind, query } = opts;

  if (!query) {
    return {
      success: false,
      tags: [],
      error: 'query is required',
    };
  }

  try {
    const base = window.location.origin;
    const perPage = 100;
    type RawTag = {
      id: string;
      uid?: string;
      display_name: string;
      category?: string;
      num_organizations: number;
    };

    // Fetch page 1 to see if there's more
    const firstResp = await fetch(
      `${base}/api/v1/tags/search?kind=${kind}&per_page=${perPage}&page=1`,
      { credentials: 'include' },
    );
    const firstData = await firstResp.json();
    const firstBatch: RawTag[] = firstData.tags || [];
    const allTags: RawTag[] = [...firstBatch];

    // If page 1 is full, fetch remaining pages in parallel
    if (firstBatch.length === perPage) {
      const maxPages = kind === 'linkedin_industry' ? 3 : 25;
      const pageNums = Array.from({ length: maxPages - 1 }, (_, i) => i + 2);
      const results = await Promise.all(
        pageNums.map((page) =>
          fetch(
            `${base}/api/v1/tags/search?kind=${kind}&per_page=${perPage}&page=${page}`,
            { credentials: 'include' },
          ).then((r) => r.json()),
        ),
      );
      for (const data of results) {
        const batch: RawTag[] = data.tags || [];
        if (batch.length > 0) allTags.push(...batch);
      }
    }

    // Client-side filter by query
    const queryLower = query.toLowerCase();
    const filtered = allTags.filter((t) =>
      t.display_name?.toLowerCase().includes(queryLower),
    );

    // For technologies, return uid (used by currently_using_any_of_technology_uids filter).
    // For industries, return id (used by organization_linkedin_industry_tag_ids filter).
    const tags = filtered.slice(0, 20).map((t) => ({
      id: kind === 'technology' && t.uid ? t.uid : t.id,
      name: t.display_name,
      ...(t.category ? { category: t.category } : {}),
      numOrganizations: t.num_organizations || 0,
    }));

    return { success: true, tags };
  } catch (err) {
    return {
      success: false,
      tags: [],
      error: (err as Error).message,
    };
  }
}

/**
 * Get current account plan details including enabled features, credits, and limits.
 * Uses /api/v1/teams/current for real-time credit balance (not cached bootstrapped data).
 */
export async function getPlanDetails(): Promise<GetPlanDetailsOutput> {
  try {
    const base = window.location.origin;

    // Use teams/current for real-time credit balance
    const [bootstrapRes, teamRes] = await Promise.all([
      fetch(`${base}/api/v1/auth/additional_bootstrapped_data?mobile=false`, {
        credentials: 'include',
      }),
      fetch(`${base}/api/v1/teams/current`, { credentials: 'include' }),
    ]);

    const data = await bootstrapRes.json();
    const teamData = teamRes.ok ? await teamRes.json() : null;

    // Bootstrap has feature flags/limitations; teams/current has real-time credits
    const team = data.bootstrapped_data?.teams?.[0];
    const liveTeam = teamData?.team;

    if (!team) {
      return {
        success: false,
        plan: {
          status: 'unknown',
          credits: {
            totalCredits: 0,
            creditsUsed: 0,
            costPerEmailReveal: 1,
            costPerPhoneReveal: 8,
            aiCredits: 0,
            unlimitedLeads: false,
          },
          seatsLimit: 0,
          seatsUsed: 0,
          mailboxLimit: 0,
          enabledFeatures: [],
          featureLimitations: {},
        },
        error: 'No team data found. User may not be logged in.',
      };
    }

    const activeProduct = team.active_product_infos?.[0];

    return {
      success: true,
      plan: {
        status: team.status ?? 'unknown',
        ...(activeProduct
          ? {
              product: {
                productId: activeProduct.product_id,
                planId: activeProduct.plan_id,
                isTrial: activeProduct.is_trial,
                ...(activeProduct.start_date
                  ? { startDate: activeProduct.start_date }
                  : {}),
                ...(activeProduct.end_date
                  ? { endDate: activeProduct.end_date }
                  : {}),
              },
            }
          : {}),
        credits: {
          totalCredits:
            liveTeam?.effective_num_lead_credits ??
            team.effective_num_lead_credits ??
            team.num_credits ??
            0,
          creditsUsed:
            liveTeam?.num_lead_credits_used ?? team.num_lead_credits_used ?? 0,
          costPerEmailReveal:
            team.unified_credit_cost_mapping?.lead_credit ?? 1,
          costPerPhoneReveal:
            team.unified_credit_cost_mapping?.direct_dial_credit ?? 8,
          aiCredits:
            liveTeam?.effective_num_ai_credits ??
            team.effective_num_ai_credits ??
            team.num_ai_credits ??
            0,
          unlimitedLeads: team.has_unlimited_lead_credits ?? false,
        },
        seatsLimit: team.seats_limit ?? 0,
        seatsUsed: team.active_user_count_for_billing_purpose ?? 0,
        mailboxLimit: team.mailbox_limit ?? 0,
        enabledFeatures: team.active_product_feature_ids ?? [],
        featureLimitations: team.feature_limitations ?? {},
      },
    };
  } catch (err) {
    return {
      success: false,
      plan: {
        status: 'unknown',
        credits: {
          totalCredits: 0,
          creditsUsed: 0,
          costPerEmailReveal: 1,
          costPerPhoneReveal: 8,
          aiCredits: 0,
          unlimitedLeads: false,
        },
        seatsLimit: 0,
        seatsUsed: 0,
        mailboxLimit: 0,
        enabledFeatures: [],
        featureLimitations: {},
      },
      error: (err as Error).message,
    };
  }
}
