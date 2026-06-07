// Types from schemas - single source of truth
export type {
  DiscoverCompany,
  DiscoverMeta,
  DomainEmail,
  EmailSource,
  Lead,
  GetContextInput,
  GetAccountInput,
  GetAccountOutput,
  GetEmailCountInput,
  GetEmailCountOutput,
  FindEmailInput,
  FindEmailOutput,
  VerifyEmailInput,
  VerifyEmailOutput,
  DiscoverCompaniesInput,
  SearchDomainInput,
  CreateLeadInput,
  AddCampaignRecipientInput,
  GetContextOutput,
  DiscoverCompaniesOutput,
  SearchDomainOutput,
  CreateLeadOutput,
  AddCampaignRecipientOutput,
} from './schemas';

export type {
  ListLeadsInput,
  ListLeadsOutput,
  GetLeadInput,
  GetLeadOutput,
  UpdateLeadInput,
  UpdateLeadOutput,
  DeleteLeadInput,
  DeleteLeadOutput,
} from './schemas-leads';

export type {
  EnrichPersonInput,
  EnrichPersonOutput,
  EnrichCompanyInput,
  EnrichCompanyOutput,
  EnrichCombinedInput,
  EnrichCombinedOutput,
} from './schemas-enrichment';

export type {
  LeadListSummary,
  CustomAttribute,
  ListLeadListsInput,
  ListLeadListsOutput,
  GetLeadListInput,
  GetLeadListOutput,
  CreateLeadListInput,
  CreateLeadListOutput,
  UpdateLeadListInput,
  UpdateLeadListOutput,
  DeleteLeadListInput,
  DeleteLeadListOutput,
  ListCustomAttributesInput,
  ListCustomAttributesOutput,
  CreateCustomAttributeInput,
  CreateCustomAttributeOutput,
  UpdateCustomAttributeInput,
  UpdateCustomAttributeOutput,
  DeleteCustomAttributeInput,
  DeleteCustomAttributeOutput,
} from './schemas-lists-attrs';

export type {
  Campaign,
  CampaignRecipient,
  ListCampaignsInput,
  ListCampaignsOutput,
  GetCampaignInput,
  GetCampaignOutput,
  ListCampaignRecipientsInput,
  ListCampaignRecipientsOutput,
  RemoveCampaignRecipientInput,
  RemoveCampaignRecipientOutput,
  StartCampaignInput,
  StartCampaignOutput,
  ListSignalsInput,
  ListSignalsOutput,
  CreateSignalInput,
  CreateSignalOutput,
} from './schemas-campaigns-signals';

import { Validation, NotFound, UpstreamError, Unauthenticated, throwForStatus } from '@vallum/_runtime';

import type {
  GetContextOutput,
  GetAccountInput,
  GetAccountOutput,
  GetEmailCountInput,
  GetEmailCountOutput,
  FindEmailInput,
  FindEmailOutput,
  VerifyEmailInput,
  VerifyEmailOutput,
  DiscoverCompaniesInput,
  DiscoverCompaniesOutput,
  SearchDomainInput,
  SearchDomainOutput,
  CreateLeadInput,
  CreateLeadOutput,
  AddCampaignRecipientInput,
  AddCampaignRecipientOutput,
} from './schemas';

import type {
  ListLeadsInput,
  ListLeadsOutput,
  GetLeadInput,
  GetLeadOutput,
  UpdateLeadInput,
  UpdateLeadOutput,
  DeleteLeadInput,
  DeleteLeadOutput,
} from './schemas-leads';

import type {
  EnrichPersonInput,
  EnrichPersonOutput,
  EnrichCompanyInput,
  EnrichCompanyOutput,
  EnrichCombinedInput,
  EnrichCombinedOutput,
} from './schemas-enrichment';

import type {
  ListLeadListsInput,
  ListLeadListsOutput,
  GetLeadListInput,
  GetLeadListOutput,
  CreateLeadListInput,
  CreateLeadListOutput,
  UpdateLeadListInput,
  UpdateLeadListOutput,
  DeleteLeadListInput,
  DeleteLeadListOutput,
  ListCustomAttributesInput,
  ListCustomAttributesOutput,
  CreateCustomAttributeInput,
  CreateCustomAttributeOutput,
  UpdateCustomAttributeInput,
  UpdateCustomAttributeOutput,
  DeleteCustomAttributeInput,
  DeleteCustomAttributeOutput,
} from './schemas-lists-attrs';

import type {
  ListCampaignsInput,
  ListCampaignsOutput,
  GetCampaignInput,
  GetCampaignOutput,
  ListCampaignRecipientsInput,
  ListCampaignRecipientsOutput,
  RemoveCampaignRecipientInput,
  RemoveCampaignRecipientOutput,
  StartCampaignInput,
  StartCampaignOutput,
  ListSignalsInput,
  ListSignalsOutput,
  CreateSignalInput,
  CreateSignalOutput,
} from './schemas-campaigns-signals';

// ============================================================================
// Helpers
// ============================================================================

function buildUrl(path: string, params: Record<string, string>): string {
  const url = new URL(path, window.location.origin);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

async function apiGet<T>(
  path: string,
  apiKey: string,
  params: Record<string, string> = {},
): Promise<T> {
  const url = buildUrl(path, { api_key: apiKey, ...params });
  const resp = await fetch(url, { credentials: 'include' });
  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }
  return resp.json() as Promise<T>;
}

async function apiPost<T>(
  path: string,
  apiKey: string,
  body: Record<string, unknown>,
): Promise<T> {
  const url = buildUrl(path, { api_key: apiKey });
  const resp = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }
  return resp.json() as Promise<T>;
}

async function _apiPut<T>(
  path: string,
  apiKey: string,
  body: Record<string, unknown>,
): Promise<T> {
  const url = buildUrl(path, { api_key: apiKey });
  const resp = await fetch(url, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }
  return resp.json() as Promise<T>;
}

async function apiPutNoContent(
  path: string,
  apiKey: string,
  body: Record<string, unknown>,
): Promise<void> {
  const url = buildUrl(path, { api_key: apiKey });
  const resp = await fetch(url, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }
  // 204 No Content; no body to parse
}

async function apiDelete(path: string, apiKey: string): Promise<void> {
  const url = buildUrl(path, { api_key: apiKey });
  const resp = await fetch(url, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }
}

// ============================================================================
// Context Acquisition
// ============================================================================

/**
 * Extract Hunter.io API key from embedded page scripts and CSRF token from meta tag.
 * Must be on hunter.io. Call before all other Hunter.io operations.
 */
export async function getContext(): Promise<GetContextOutput> {
  const scripts = Array.from(document.querySelectorAll('script'))
    .map((s) => s.textContent ?? '')
    .join('\n');

  const keyMatch = scripts.match(/api_key="([a-f0-9]{30,})"/);
  if (!keyMatch) {
    throw new Unauthenticated(
      `Hunter.io API key not found in page scripts. URL: ${window.location.href}`,
    );
  }
  const apiKey = keyMatch[1];

  const csrfMeta = document.querySelector('meta[name=csrf-token]');
  if (!csrfMeta) {
    throw new Unauthenticated(
      `CSRF meta tag not found. User may not be logged in. URL: ${window.location.href}`,
    );
  }
  const csrfToken = (csrfMeta as HTMLMetaElement).content;

  if (!csrfToken) {
    throw new Unauthenticated(`CSRF token is empty. URL: ${window.location.href}`);
  }

  return { apiKey, csrfToken };
}

// ============================================================================
// Account
// ============================================================================

/**
 * Get Hunter.io account details including credit balance, usage limits, and plan tier.
 */
export async function getAccount(
  params: GetAccountInput,
): Promise<GetAccountOutput> {
  const { apiKey } = params;
  return apiGet<GetAccountOutput>('/v2/account', apiKey);
}

// ============================================================================
// Email Count
// ============================================================================

/**
 * Count discoverable email addresses for a domain. Free, no credit cost.
 */
export async function getEmailCount(
  params: GetEmailCountInput,
): Promise<GetEmailCountOutput> {
  const { apiKey, domain, type } = params;

  if (!domain) {
    throw new Validation('getEmailCount: domain is required');
  }

  const queryParams: Record<string, string> = { domain };
  if (type) queryParams['type'] = type;

  return apiGet<GetEmailCountOutput>('/v2/email-count', apiKey, queryParams);
}

// ============================================================================
// Email Finder
// ============================================================================

/**
 * Find a person's email address given their name and company domain.
 */
export async function findEmail(
  params: FindEmailInput,
): Promise<FindEmailOutput> {
  let { apiKey } = params;
  const {
    domain,
    first_name,
    last_name,
    full_name,
    company,
    linkedin_handle,
    max_duration,
  } = params;

  if (!apiKey) {
    const ctx = await getContext();
    apiKey = ctx.apiKey;
  }

  const queryParams: Record<string, string> = {};

  if (domain) queryParams['domain'] = domain;
  if (first_name) queryParams['first_name'] = first_name;
  if (last_name) queryParams['last_name'] = last_name;
  if (full_name) queryParams['full_name'] = full_name;
  if (company) queryParams['company'] = company;
  if (linkedin_handle) queryParams['linkedin_handle'] = linkedin_handle;
  if (max_duration !== undefined)
    queryParams['max_duration'] = String(max_duration);

  return apiGet<FindEmailOutput>('/v2/email-finder', apiKey, queryParams);
}

// ============================================================================
// Email Verifier
// ============================================================================

/**
 * Verify the deliverability of an email address with SMTP checks.
 */
export async function verifyEmail(
  params: VerifyEmailInput,
): Promise<VerifyEmailOutput> {
  const { apiKey, email } = params;

  if (!apiKey) {
    throw new Validation('verifyEmail: Missing required parameter: apiKey');
  }
  if (!email) {
    throw new Validation('verifyEmail: Missing required parameter: email');
  }

  return apiGet<VerifyEmailOutput>('/v2/email-verifier', apiKey, { email });
}

// ============================================================================
// Discover Companies
// ============================================================================

/**
 * Search and discover companies by headcount using Hunter Discover.
 */
export async function discoverCompanies(
  params: DiscoverCompaniesInput,
): Promise<DiscoverCompaniesOutput> {
  let apiKey = params.apiKey;
  if (!apiKey) {
    const ctx = await getContext();
    apiKey = ctx.apiKey;
  }

  const body: Record<string, unknown> = {};

  if (params.headcount) {
    body['headcount'] = params.headcount;
  }

  return apiPost<DiscoverCompaniesOutput>('/v2/discover', apiKey, body);
}

// ============================================================================
// Domain Search
// ============================================================================

/**
 * Search all known email addresses for a given domain.
 */
export async function searchDomain(
  params: SearchDomainInput,
): Promise<SearchDomainOutput> {
  let apiKey = params.apiKey;
  if (!apiKey) {
    const ctx = await getContext();
    apiKey = ctx.apiKey;
  }

  const {
    domain,
    company,
    limit = 10,
    offset = 0,
    type,
    seniority,
    department,
    required_field,
    verification_status,
    job_titles,
    location,
  } = params;

  if (!domain && !company) {
    throw new Validation(
      'searchDomain: either domain or company is required (e.g. domain="stripe.com" or company="Stripe")',
    );
  }

  // location filter requires POST; arrays sent as JSON arrays in body
  if (location) {
    const body: Record<string, unknown> = {
      limit,
      offset,
      location,
    };
    if (domain) body['domain'] = domain;
    if (company) body['company'] = company;
    if (type) body['type'] = type;
    if (seniority?.length) body['seniority'] = seniority;
    if (department) body['department'] = department;
    if (required_field?.length) body['required_field'] = required_field;
    if (verification_status?.length)
      body['verification_status'] = verification_status;
    if (job_titles?.length) body['job_titles'] = job_titles;
    return apiPost<SearchDomainOutput>('/v2/domain-search', apiKey, body);
  }

  const queryParams: Record<string, string> = {
    limit: String(limit),
    offset: String(offset),
  };

  if (domain) queryParams['domain'] = domain;
  if (company) queryParams['company'] = company;
  if (type) queryParams['type'] = type;
  if (seniority?.length) queryParams['seniority'] = seniority.join(',');
  if (department) queryParams['department'] = department;
  if (required_field?.length)
    queryParams['required_field'] = required_field.join(',');
  if (verification_status?.length)
    queryParams['verification_status'] = verification_status.join(',');
  if (job_titles?.length) queryParams['job_titles'] = job_titles.join(',');

  return apiGet<SearchDomainOutput>('/v2/domain-search', apiKey, queryParams);
}

// ============================================================================
// Leads
// ============================================================================

/**
 * Create a new lead in Hunter.io.
 */
export async function createLead(
  params: CreateLeadInput,
): Promise<CreateLeadOutput> {
  const { apiKey, ...body } = params;

  const cleanBody: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined) {
      cleanBody[key] = value;
    }
  }

  return apiPost<CreateLeadOutput>('/v2/leads', apiKey, cleanBody);
}

/**
 * List saved leads with optional filters.
 */
export async function listLeads(
  params: ListLeadsInput,
): Promise<ListLeadsOutput> {
  let apiKey = params.apiKey;
  if (!apiKey) {
    const ctx = await getContext();
    apiKey = ctx.apiKey;
  }
  const {
    limit = 20,
    offset = 0,
    leads_list_id,
    email,
    first_name,
    last_name,
    query,
    company,
    position,
    website,
    linkedin_url,
    phone_number,
    twitter,
    country_code,
    lead_country_code,
    source,
    company_industry,
    company_size,
    company_type,
    sync_status,
    sending_status,
    verification_status,
  } = params;

  // Build URL manually to support array params (sending_status[], verification_status[])
  const url = new URL('/v2/leads', window.location.origin);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String(offset));

  if (leads_list_id !== undefined)
    url.searchParams.set('leads_list_id', String(leads_list_id));
  if (email) url.searchParams.set('email', email);
  if (first_name) url.searchParams.set('first_name', first_name);
  if (last_name) url.searchParams.set('last_name', last_name);
  if (query) url.searchParams.set('query', query);
  if (company) url.searchParams.set('company', company);
  if (position) url.searchParams.set('position', position);
  if (website) url.searchParams.set('website', website);
  if (linkedin_url) url.searchParams.set('linkedin_url', linkedin_url);
  if (phone_number) url.searchParams.set('phone_number', phone_number);
  if (twitter) url.searchParams.set('twitter', twitter);
  if (country_code) url.searchParams.set('country_code', country_code);
  if (lead_country_code)
    url.searchParams.set('lead_country_code', lead_country_code);
  if (source) url.searchParams.set('source', source);
  if (company_industry)
    url.searchParams.set('company_industry', company_industry);
  if (company_size) url.searchParams.set('company_size', company_size);
  if (company_type) url.searchParams.set('company_type', company_type);
  if (sync_status) url.searchParams.set('sync_status', sync_status);

  // Array params require bracket notation: sending_status[]=value
  if (sending_status?.length) {
    for (const val of sending_status) {
      url.searchParams.append('sending_status[]', val);
    }
  }
  if (verification_status?.length) {
    for (const val of verification_status) {
      url.searchParams.append('verification_status[]', val);
    }
  }

  const resp = await fetch(url.toString(), { credentials: 'include' });
  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }
  return resp.json() as Promise<ListLeadsOutput>;
}

/**
 * Get a single lead by its ID.
 */
export async function getLead(params: GetLeadInput): Promise<GetLeadOutput> {
  const { apiKey, leadId } = params;
  if (!leadId) {
    throw new Validation('getLead: leadId is required');
  }
  return apiGet<GetLeadOutput>(`/v2/leads/${leadId}`, apiKey);
}

/**
 * Update a lead's fields by ID.
 * PUT returns 204 No Content, so we GET the lead afterward to return updated data.
 */
export async function updateLead(
  params: UpdateLeadInput,
): Promise<UpdateLeadOutput> {
  let { apiKey } = params;
  const { leadId, ...body } = params;
  if (!leadId) {
    throw new Validation('updateLead: leadId is required');
  }
  if (!apiKey) {
    const ctx = await getContext();
    apiKey = ctx.apiKey;
  }

  const cleanBody: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined) {
      cleanBody[key] = value;
    }
  }

  await apiPutNoContent(`/v2/leads/${leadId}`, apiKey, cleanBody);

  // PUT returns 204 No Content; fetch the updated lead
  return apiGet<UpdateLeadOutput>(`/v2/leads/${leadId}`, apiKey);
}

/**
 * Delete a lead by its ID.
 */
export async function deleteLead(
  params: DeleteLeadInput,
): Promise<DeleteLeadOutput> {
  const { apiKey, leadId } = params;
  await apiDelete(`/v2/leads/${leadId}`, apiKey);
  return { success: true };
}

// ============================================================================
// Lead Lists
// ============================================================================

/**
 * List all lead lists with pagination.
 */
export async function listLeadLists(
  params: ListLeadListsInput,
): Promise<ListLeadListsOutput> {
  let apiKey = params.apiKey;
  if (!apiKey) {
    const ctx = await getContext();
    apiKey = ctx.apiKey;
  }
  const { limit = 20, offset = 0 } = params;

  return apiGet<ListLeadListsOutput>('/v2/leads_lists', apiKey, {
    limit: String(limit),
    offset: String(offset),
  });
}

/**
 * Get a single lead list by ID, including its leads with pagination.
 */
export async function getLeadList(
  params: GetLeadListInput,
): Promise<GetLeadListOutput> {
  let { apiKey } = params;
  if (!apiKey) {
    const ctx = await getContext();
    apiKey = ctx.apiKey;
  }
  const { id, limit = 20, offset = 0 } = params;

  return apiGet<GetLeadListOutput>(`/v2/leads_lists/${id}`, apiKey, {
    limit: String(limit),
    offset: String(offset),
  });
}

/**
 * Create a new lead list with the given name.
 */
export async function createLeadList(
  params: CreateLeadListInput,
): Promise<CreateLeadListOutput> {
  let { apiKey } = params;
  const { name, leads_list_folder_id } = params;
  if (!apiKey) {
    const ctx = await getContext();
    apiKey = ctx.apiKey;
  }

  const body: Record<string, unknown> = { name };
  if (leads_list_folder_id !== undefined)
    body['leads_list_folder_id'] = leads_list_folder_id;

  return apiPost<CreateLeadListOutput>('/v2/leads_lists', apiKey, body);
}

/**
 * Rename an existing lead list.
 */
export async function updateLeadList(
  params: UpdateLeadListInput,
): Promise<UpdateLeadListOutput> {
  let { apiKey } = params;
  const { id, name } = params;

  if (id === undefined || id === null) {
    throw new Validation('updateLeadList: id is required');
  }
  if (!name) {
    throw new Validation('updateLeadList: name is required and must be non-empty');
  }

  if (!apiKey) {
    const ctx = await getContext();
    apiKey = ctx.apiKey;
  }

  await apiPutNoContent(`/v2/leads_lists/${id}`, apiKey, { name });
  return { success: true as const };
}

/**
 * Delete a lead list by ID.
 */
export async function deleteLeadList(
  params: DeleteLeadListInput,
): Promise<DeleteLeadListOutput> {
  const { apiKey, id } = params;

  await apiDelete(`/v2/leads_lists/${id}`, apiKey);
  return { success: true as const };
}

// ============================================================================
// Custom Attributes
// ============================================================================

/**
 * List all custom lead attributes.
 */
export async function listCustomAttributes(
  params: ListCustomAttributesInput,
): Promise<ListCustomAttributesOutput> {
  let { apiKey } = params;
  if (!apiKey) {
    const ctx = await getContext();
    apiKey = ctx.apiKey;
  }

  return apiGet<ListCustomAttributesOutput>(
    '/v2/leads_custom_attributes',
    apiKey,
  );
}

/**
 * Create a new custom lead attribute.
 */
export async function createCustomAttribute(
  params: CreateCustomAttributeInput,
): Promise<CreateCustomAttributeOutput> {
  let { apiKey } = params;
  if (!apiKey) {
    const ctx = await getContext();
    apiKey = ctx.apiKey;
  }
  const { label, default_value, description } = params;

  const body: Record<string, unknown> = { label };
  if (default_value !== undefined) body['default_value'] = default_value;
  if (description !== undefined) body['description'] = description;

  return apiPost<CreateCustomAttributeOutput>(
    '/v2/leads_custom_attributes',
    apiKey,
    body,
  );
}

/**
 * Update an existing custom lead attribute (label, default_value, or description).
 */
export async function updateCustomAttribute(
  params: UpdateCustomAttributeInput,
): Promise<UpdateCustomAttributeOutput> {
  let { apiKey } = params;
  if (!apiKey) {
    const ctx = await getContext();
    apiKey = ctx.apiKey;
  }
  const { id, label, default_value, description } = params;

  if (!id) {
    throw new Validation('updateCustomAttribute: id is required');
  }
  if (!label) {
    throw new Validation('updateCustomAttribute: label is required');
  }

  const body: Record<string, unknown> = { label };
  if (default_value !== undefined) body['default_value'] = default_value;
  if (description !== undefined) body['description'] = description;

  await apiPutNoContent(`/v2/leads_custom_attributes/${id}`, apiKey, body);
  return { success: true as const };
}

/**
 * Delete a custom lead attribute by ID.
 */
export async function deleteCustomAttribute(
  params: DeleteCustomAttributeInput,
): Promise<DeleteCustomAttributeOutput> {
  const { apiKey, id } = params;

  if (!id) {
    throw new Validation('deleteCustomAttribute: id is required');
  }

  await apiDelete(`/v2/leads_custom_attributes/${id}`, apiKey);
  return { success: true as const };
}

// ============================================================================
// Enrichment
// ============================================================================

/**
 * Enrich a person by email or LinkedIn handle.
 * Returns 100+ attributes including employment, social profiles, location, and activity.
 */
export async function enrichPerson(
  params: EnrichPersonInput,
): Promise<EnrichPersonOutput> {
  let { apiKey } = params;
  const { email, linkedinHandle, clearbit_format } = params;

  if (!email && !linkedinHandle) {
    throw new Validation('enrichPerson requires either email or linkedinHandle');
  }

  if (!apiKey) {
    const ctx = await getContext();
    apiKey = ctx.apiKey;
  }

  const queryParams: Record<string, string> = {};
  if (email) {
    queryParams['email'] = email;
  } else if (linkedinHandle) {
    queryParams['linkedin_handle'] = linkedinHandle;
  }
  if (clearbit_format !== undefined) {
    queryParams['clearbit_format'] = clearbit_format;
  }

  return apiGet<EnrichPersonOutput>('/v2/people/find', apiKey, queryParams);
}

/**
 * Enrich a company by domain.
 * Returns firmographic data including industry, location, social profiles, tech stack, metrics, and funding.
 */
export async function enrichCompany(
  params: EnrichCompanyInput,
): Promise<EnrichCompanyOutput> {
  let { apiKey } = params;
  const { domain, clearbit_format } = params;

  if (!domain) {
    throw new Validation('enrichCompany: domain is required');
  }

  if (!apiKey) {
    const ctx = await getContext();
    apiKey = ctx.apiKey;
  }

  const queryParams: Record<string, string> = { domain };
  if (clearbit_format !== undefined) {
    queryParams['clearbit_format'] = clearbit_format;
  }

  return apiGet<EnrichCompanyOutput>('/v2/companies/find', apiKey, queryParams);
}

/**
 * Enrich both a person and their company in a single call by email.
 * Returns full person attributes plus company firmographics.
 */
export async function enrichCombined(
  params: EnrichCombinedInput,
): Promise<EnrichCombinedOutput> {
  let { apiKey } = params;
  const { email, clearbit_format } = params;

  if (!apiKey) {
    const ctx = await getContext();
    apiKey = ctx.apiKey;
  }

  const queryParams: Record<string, string> = { email };
  if (clearbit_format !== undefined) {
    queryParams['clearbit_format'] = clearbit_format;
  }

  return apiGet<EnrichCombinedOutput>('/v2/combined/find', apiKey, queryParams);
}

// ============================================================================
// Campaigns
// ============================================================================

/**
 * Add one or more recipients to an existing Hunter.io email campaign.
 */
export async function addCampaignRecipient(
  params: AddCampaignRecipientInput,
): Promise<AddCampaignRecipientOutput> {
  const { apiKey, campaignId, emails, leadIds } = params;

  if (!campaignId) {
    throw new Validation('addCampaignRecipient: campaignId is required');
  }

  if (!emails?.length && !leadIds?.length) {
    throw new Validation('At least one of emails or leadIds must be provided');
  }

  const totalCount = (emails?.length ?? 0) + (leadIds?.length ?? 0);
  if (totalCount > 50) {
    throw new Validation(
      `addCampaignRecipient: at most 50 emails/leadIds per call, got ${totalCount}`,
    );
  }

  const body: Record<string, unknown> = {};
  if (emails?.length) body['emails'] = emails;
  if (leadIds?.length) body['lead_ids'] = leadIds;

  return apiPost<AddCampaignRecipientOutput>(
    `/v2/campaigns/${campaignId}/recipients`,
    apiKey,
    body,
  );
}

/**
 * List all email campaigns/sequences with pagination.
 */
export async function listCampaigns(
  params: ListCampaignsInput,
): Promise<ListCampaignsOutput> {
  let { apiKey } = params;
  const { limit = 20, offset = 0, started, archived } = params;
  if (!apiKey) {
    const ctx = await getContext();
    apiKey = ctx.apiKey;
  }

  const queryParams: Record<string, string> = {
    limit: String(limit),
    offset: String(offset),
  };

  if (started !== undefined) queryParams['started'] = String(started);
  if (archived !== undefined) queryParams['archived'] = String(archived);

  return apiGet<ListCampaignsOutput>('/v2/campaigns', apiKey, queryParams);
}

/**
 * Get a single campaign by ID.
 * Hunter.io has no dedicated single-campaign endpoint, so this fetches from
 * the list API and filters by ID.
 */
export async function getCampaign(
  params: GetCampaignInput,
): Promise<GetCampaignOutput> {
  let { apiKey } = params;
  const { id, started, archived } = params;

  if (!apiKey) {
    const ctx = await getContext();
    apiKey = ctx.apiKey;
  }

  if (id === undefined || id === null) {
    throw new Validation('getCampaign: id is required');
  }

  let offset = 0;
  const limit = 100;

  while (true) {
    const queryParams: Record<string, string> = {
      limit: String(limit),
      offset: String(offset),
    };
    if (started !== undefined) queryParams['started'] = String(started);
    if (archived !== undefined) queryParams['archived'] = String(archived);

    const result = await apiGet<ListCampaignsOutput>(
      '/v2/campaigns',
      apiKey,
      queryParams,
    );

    const campaign = result.data.campaigns.find((c) => c.id === id);
    if (campaign) {
      return { data: campaign };
    }

    if (result.data.campaigns.length < limit) {
      throw new NotFound(
        `Campaign ${id} not found. Searched ${offset + result.data.campaigns.length} campaigns.`,
      );
    }

    offset += limit;
  }
}

/**
 * List recipients of a campaign/sequence with pagination.
 */
export async function listCampaignRecipients(
  params: ListCampaignRecipientsInput,
): Promise<ListCampaignRecipientsOutput> {
  let { apiKey } = params;
  const { campaignId, limit = 20, offset = 0 } = params;

  if (campaignId === undefined || campaignId === null) {
    throw new Validation('listCampaignRecipients: campaignId is required');
  }

  if (!apiKey) {
    const ctx = await getContext();
    apiKey = ctx.apiKey;
  }

  return apiGet<ListCampaignRecipientsOutput>(
    `/v2/campaigns/${campaignId}/recipients`,
    apiKey,
    {
      limit: String(limit),
      offset: String(offset),
    },
  );
}

/**
 * Cancel all scheduled emails for one or more recipients in a campaign.
 */
export async function removeCampaignRecipient(
  params: RemoveCampaignRecipientInput,
): Promise<RemoveCampaignRecipientOutput> {
  const { apiKey, campaignId, emails } = params;

  if (campaignId === undefined || campaignId === null) {
    throw new Validation('removeCampaignRecipient: campaignId is required');
  }

  if (!emails || !emails.length) {
    throw new Validation('At least one email address must be provided');
  }

  const url = buildUrl(`/v2/campaigns/${campaignId}/recipients`, {
    api_key: apiKey,
  });
  const resp = await fetch(url, {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emails }),
  });
  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }
  return resp.json() as Promise<RemoveCampaignRecipientOutput>;
}

/**
 * Start a draft campaign/sequence to begin sending emails.
 */
export async function startCampaign(
  params: StartCampaignInput,
): Promise<StartCampaignOutput> {
  const { apiKey, campaignId } = params;

  if (!apiKey) {
    throw new Validation('startCampaign: apiKey is required');
  }

  if (campaignId === undefined || campaignId === null) {
    throw new Validation('startCampaign: campaignId is required');
  }

  return apiPost<StartCampaignOutput>(
    `/v2/campaigns/${campaignId}/start`,
    apiKey,
    {},
  );
}

/**
 * List signal monitors configured in the account.
 * Parses the /signals HTML page; no JSON API exists for this endpoint.
 */
export async function listSignals(
  params: ListSignalsInput,
): Promise<ListSignalsOutput> {
  const { limit = 20, offset = 0 } = params;

  const resp = await fetch('/signals', { credentials: 'include' });
  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }
  const html = await resp.text();

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  const CATEGORY_MAP: Record<string, string> = {
    'fundings and acquisitions': 'fundings_and_acquisitions',
    'job openings': 'job_openings',
    'company updates': 'company',
    company: 'company',
  };

  const allSignals: ListSignalsOutput['data']['signals'] = [];

  const cards = doc.querySelectorAll('tr.signal-card');
  for (const card of Array.from(cards)) {
    const id = parseInt(card.id.replace('signal-', ''), 10);
    if (isNaN(id)) continue;

    const name =
      card.querySelector('h2.signal-card__name a')?.textContent?.trim() ?? '';

    // ".signal-card__category" contains category display text and arrow span
    const catEl = card.querySelector('.signal-card__category');
    let categoryDisplay = '';
    let type = '';
    if (catEl) {
      const clone = catEl.cloneNode(true) as Element;
      clone.querySelector('span')?.remove();
      const parts = clone
        .textContent!.split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      categoryDisplay = parts[0]?.toLowerCase() ?? '';
      type = parts[1] ?? '';
    }
    const category = CATEGORY_MAP[categoryDisplay] ?? categoryDisplay;

    const statusEl = card.querySelector('.signal-card__status');
    const active = statusEl?.classList.contains('green') ?? false;

    // ".signal-card__creation-date" contains icon span + date text "Mar 9, 2026"
    const dateEl = card.querySelector('.signal-card__creation-date');
    let created_at = '';
    if (dateEl) {
      const clone = dateEl.cloneNode(true) as Element;
      clone.querySelector('span')?.remove();
      const dateText = clone.textContent?.trim() ?? '';
      if (dateText) {
        const parsed = new Date(dateText);
        created_at = isNaN(parsed.getTime()) ? dateText : parsed.toISOString();
      }
    }

    allSignals.push({ id, name, category, type, active, created_at });
  }

  const paginated = allSignals.slice(offset, offset + limit);

  return {
    data: { signals: paginated },
    meta: { limit, offset },
  };
}

/**
 * Create a new signal monitor.
 * Uses the Rails form endpoint POST /signals with CSRF token (not /v2/signals which returns 404).
 */
export async function createSignal(
  params: CreateSignalInput,
): Promise<CreateSignalOutput> {
  const {
    name,
    category,
    type,
    countries,
    company_sizes,
    company_industries_include,
    company_industries_exclude,
    published_date = '7d',
    published_date_from,
    published_date_to,
    series,
    amount_raised_from,
    amount_raised_to,
    filter_out_search_firms,
    title_include,
    title_exclude,
    description_include,
    description_exclude,
    job_countries,
    seniority,
    types_of_contract,
    departments,
  } = params;

  // CSRF token required for Rails form submission (not api_key)
  const ctx = await getContext();

  const formData = new URLSearchParams();
  formData.set('authenticity_token', ctx.csrfToken);
  formData.set('monitored_signal[signal_type]', type);
  formData.set('monitored_signal[signal_category]', category);
  formData.set('monitored_signal[name]', name);
  formData.set('monitored_signal[published_date]', published_date);

  // Array params: always send at least one value (empty string) to match browser form behavior
  const pushArr = (key: string, vals?: string[]) => {
    if (vals && vals.length > 0) {
      for (const v of vals) formData.append(`monitored_signal[${key}][]`, v);
    } else {
      formData.append(`monitored_signal[${key}][]`, '');
    }
  };

  // Common filters (all categories)
  pushArr('countries', countries);
  pushArr('company_sizes', company_sizes);
  pushArr('company_industries_include', company_industries_include);
  pushArr('company_industries_exclude', company_industries_exclude);

  // Job-openings-specific filters: only send for job_openings to avoid server validation errors
  if (category === 'job_openings') {
    pushArr('title_include', title_include);
    pushArr('title_exclude', title_exclude);
    pushArr('description_include', description_include);
    pushArr('description_exclude', description_exclude);
    pushArr('job_countries', job_countries);
    pushArr('seniority', seniority);
    pushArr('types_of_contract', types_of_contract);
    pushArr('departments', departments);
    if (filter_out_search_firms !== undefined)
      formData.set('filter_out_search_firms', String(filter_out_search_firms));
  }

  // Fundings-specific filters
  if (series && series.length > 0) {
    for (const s of series) formData.append('monitored_signal[series][]', s);
  }
  if (amount_raised_from !== undefined)
    formData.set(
      'monitored_signal[amount_raised_from]',
      String(amount_raised_from),
    );
  if (amount_raised_to !== undefined)
    formData.set(
      'monitored_signal[amount_raised_to]',
      String(amount_raised_to),
    );
  if (published_date_from !== undefined)
    formData.set(
      'monitored_signal[published_date_from]',
      String(published_date_from),
    );
  if (published_date_to !== undefined)
    formData.set(
      'monitored_signal[published_date_to]',
      String(published_date_to),
    );

  // POST to Rails form endpoint; follows redirect automatically
  const resp = await fetch('/signals', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData.toString(),
  });

  if (resp.status === 422) {
    const html = await resp.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const flashEl = doc.querySelector(
      '.flash--error, .flash--alert, [class*=flash]',
    );
    const errText = flashEl?.textContent?.trim() ?? 'validation failed';
    throw new Validation(`createSignal: POST /signals failed: ${errText}`);
  }

  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }

  // After redirect, resp.url is the final URL; extract signal ID if present
  const idMatch = resp.url.match(/\/signals\/(\d+)/);
  const newSignalId = idMatch ? parseInt(idMatch[1], 10) : null;

  // Fetch signals list to get the newly created signal's data
  const listResult = await listSignals({ limit: 50, offset: 0 });

  if (newSignalId) {
    const found = listResult.data.signals.find((s) => s.id === newSignalId);
    if (found) return { data: found };
  }

  const byName = listResult.data.signals.find((s) => s.name === name);
  if (byName) return { data: byName };

  if (listResult.data.signals.length > 0)
    return { data: listResult.data.signals[0] };

  throw new UpstreamError(
    'createSignal: signal was created but could not be found in list',
  );
}
