import { throwForStatus, Validation } from '@vallum/_runtime';
import { apiFetch, v1ApiFetch } from '../helpers';
import type {
  AddLeadsToCampaignInput,
  AddLeadsToCampaignOutput,
  ListCampaignLeadsInput,
  ListCampaignLeadsOutput,
  UpdateLeadCategoryInput,
  UpdateLeadCategoryOutput,
  PauseLeadInput,
  PauseLeadOutput,
  ResumeLeadInput,
  ResumeLeadOutput,
  DeleteLeadInput,
  DeleteLeadOutput,
  ExportLeadsInput,
  ExportLeadsOutput,
} from './schemas';

// ============================================================================
// Internal types
// ============================================================================

interface RawLead {
  id: number;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
  status?: string | null;
  category?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  custom_fields?: { [key: string]: unknown };
}

interface BatchImportResponse {
  ok: boolean;
  upload_count?: number | null;
  total_leads?: number | null;
}

interface LeadCategoryRecord {
  id: number;
  name: string;
}

interface PauseResumeResponse {
  ok: boolean;
  data?: string | null;
}

interface SimpleActionResponse {
  ok: boolean;
  message?: string | null;
}

interface LeadListResponse {
  leads: RawLead[];
  count: number;
}

// ============================================================================
// addLeadsToCampaign
// ============================================================================

const BATCH_SIZE = 400;

/**
 * Import leads into a campaign. Auto-batches at 400 leads per API call.
 */
export async function addLeadsToCampaign(
  params: AddLeadsToCampaignInput,
): Promise<AddLeadsToCampaignOutput> {
  const { apiKey, campaignId, leads } = params;
  const results: BatchImportResponse[] = [];
  let totalAdded = 0;

  for (let i = 0; i < leads.length; i += BATCH_SIZE) {
    const batch = leads.slice(i, i + BATCH_SIZE);

    const res = await v1ApiFetch(
      apiKey,
      `/api/v1/campaigns/${campaignId}/leads`,
      {
        method: 'POST',
        body: JSON.stringify({ lead_list: batch }),
      },
    );

    if (!res.ok) {
      throwForStatus(res.status, await res.text().catch(() => undefined));
    }

    const data = (await res.json()) as BatchImportResponse;
    results.push(data);
    if (data.ok) {
      totalAdded += data.upload_count ?? batch.length;
    }
  }

  return {
    total_added: totalAdded,
    batches: results.length,
    results: results.map((r) => ({ ok: r.ok, total_leads: r.total_leads })),
  };
}

// ============================================================================
// listCampaignLeads
// ============================================================================

/**
 * List leads in a campaign. Auto-paginates to retrieve all leads.
 */
export async function listCampaignLeads(
  params: ListCampaignLeadsInput,
): Promise<ListCampaignLeadsOutput> {
  const { token, campaignId, status } = params;

  const qs = new URLSearchParams({ limit: '100' });
  if (status) {
    qs.set('status', status);
  }

  const res = await apiFetch(
    token,
    `/api/email-campaigns/${campaignId}/leads?${qs}`,
  );

  if (!res.ok) {
    throwForStatus(res.status, await res.text().catch(() => undefined));
  }

  const data = (await res.json()) as LeadListResponse;
  const leads = data.leads ?? [];

  return {
    leads,
    total: data.count ?? leads.length,
  };
}

// ============================================================================
// updateLeadCategory
// ============================================================================

/**
 * Update the intent/category label for a lead.
 */
export async function updateLeadCategory(
  params: UpdateLeadCategoryInput,
): Promise<UpdateLeadCategoryOutput> {
  const { token, apiKey, campaignId, leadId, category } = params;

  // Resolve human-readable category name to numeric category_id via internal API
  const catRes = await apiFetch(token, '/api/lead-categories');
  if (!catRes.ok) {
    throwForStatus(catRes.status, await catRes.text().catch(() => undefined));
  }
  const categories = (await catRes.json()) as LeadCategoryRecord[];
  const match = categories.find(
    (c) => c.name.toLowerCase() === category.toLowerCase(),
  );
  if (!match) {
    throw new Validation(
      `unknown category "${category}". Available: ${categories.map((c) => c.name).join(', ')}`,
    );
  }

  const res = await v1ApiFetch(
    apiKey,
    `/api/v1/campaigns/${campaignId}/leads/${leadId}/category`,
    {
      method: 'POST',
      body: JSON.stringify({ category_id: match.id }),
    },
  );

  if (!res.ok) {
    throwForStatus(res.status, await res.text().catch(() => undefined));
  }

  const data = (await res.json()) as SimpleActionResponse;
  return { ok: data.ok, message: data.message };
}

// ============================================================================
// pauseLead
// ============================================================================

/**
 * Pause a specific lead within a campaign.
 */
export async function pauseLead(
  params: PauseLeadInput,
): Promise<PauseLeadOutput> {
  const { apiKey, campaignId, leadId } = params;

  const res = await v1ApiFetch(
    apiKey,
    `/api/v1/campaigns/${campaignId}/leads/${leadId}/pause`,
    { method: 'POST', body: '{}' },
  );

  if (!res.ok) {
    throwForStatus(res.status, await res.text().catch(() => undefined));
  }

  const data = (await res.json()) as PauseResumeResponse;
  return { ok: data.ok, message: data.data ?? null };
}

// ============================================================================
// resumeLead
// ============================================================================

/**
 * Resume a paused lead within a campaign.
 */
export async function resumeLead(
  params: ResumeLeadInput,
): Promise<ResumeLeadOutput> {
  const { apiKey, campaignId, leadId } = params;

  const res = await v1ApiFetch(
    apiKey,
    `/api/v1/campaigns/${campaignId}/leads/${leadId}/resume`,
    { method: 'POST', body: '{}' },
  );

  if (!res.ok) {
    throwForStatus(res.status, await res.text().catch(() => undefined));
  }

  const data = (await res.json()) as PauseResumeResponse;
  return { ok: data.ok, message: data.data ?? null };
}

// ============================================================================
// deleteLead
// ============================================================================

/**
 * Remove a lead from a campaign.
 */
export async function deleteLead(
  params: DeleteLeadInput,
): Promise<DeleteLeadOutput> {
  const { apiKey, campaignId, leadId } = params;

  const res = await v1ApiFetch(
    apiKey,
    `/api/v1/campaigns/${campaignId}/leads/${leadId}`,
    { method: 'DELETE' },
  );

  if (!res.ok) {
    throwForStatus(res.status, await res.text().catch(() => undefined));
  }

  // v1 DELETE returns 'success' string on success
  const body = (await res.text()) as string;
  return { ok: true, message: body };
}

// ============================================================================
// exportLeads
// ============================================================================

/**
 * Export all leads from a campaign as a structured list. Auto-paginates.
 */
export async function exportLeads(
  params: ExportLeadsInput,
): Promise<ExportLeadsOutput> {
  const { token, campaignId, status } = params;

  const qs = new URLSearchParams({ limit: '100' });
  if (status) {
    qs.set('status', status);
  }

  const res = await apiFetch(
    token,
    `/api/email-campaigns/${campaignId}/leads?${qs}`,
  );

  if (!res.ok) {
    throwForStatus(res.status, await res.text().catch(() => undefined));
  }

  const data = (await res.json()) as LeadListResponse;
  const leads = data.leads ?? [];

  return {
    leads,
    total: data.count ?? leads.length,
  };
}
