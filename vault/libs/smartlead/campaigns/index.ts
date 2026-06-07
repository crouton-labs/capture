import { throwForStatus } from '@vallum/_runtime';
import { apiFetch, gqlFetch, paginateAll } from '../helpers';
import type {
  ListCampaignsInput,
  ListCampaignsOutput,
  CreateCampaignInput,
  CreateCampaignOutput,
  GetCampaignInput,
  GetCampaignOutput,
  DeleteCampaignInput,
  DeleteCampaignOutput,
  ResumeCampaignInput,
  ResumeCampaignOutput,
  GetCampaignAnalyticsInput,
  GetCampaignAnalyticsOutput,
  PauseCampaignInput,
  PauseCampaignOutput,
  UpdateCampaignInput,
  UpdateCampaignOutput,
} from './schemas';

// ============================================================================
// Internal types (not exported — implementation detail)
// ============================================================================

interface SimpleOkResponse {
  ok: boolean;
}

interface AnalyticsResponse {
  data: {
    sent?: number;
    open_count?: number;
    open_rate?: number;
    click_count?: number;
    click_rate?: number;
    reply_count?: number;
    reply_rate?: number;
    bounce_count?: number;
    bounce_rate?: number;
    unsubscribed_count?: number;
    unsubscribed_rate?: number;
  };
}

interface RawCampaignLeadStats {
  total?: number;
  active?: number;
  paused?: number;
  bounced?: number;
  unsubscribed?: number;
  completed?: number;
}

interface RawCampaign {
  id: number;
  user_id: number;
  created_at: string;
  updated_at: string;
  status: 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'DRAFTED' | 'STOPPED';
  name: string;
  track_settings?: string | null;
  scheduler_cron_value?: unknown;
  min_time_btwn_emails?: number | null;
  max_leads_per_day?: number | null;
  stop_lead_settings?: string | null;
  unsubscribe_text?: string | null;
  client_id?: number | null;
  parent_campaign_id?: number | null;
  subsequence_scheduled_count?: number;
  subsequence_active_count?: number;
  campaign_lead_stats?: RawCampaignLeadStats;
}

interface CreateCampaignResponseData {
  id: number;
  name: string;
  status: string;
  created_at: string;
}

interface CreateCampaignResponse {
  ok: boolean;
  data: CreateCampaignResponseData;
}

interface CreateCampaignBody {
  name: string;
  timezone?: string;
  track_settings?: string;
  stop_lead_settings?: string;
  max_leads_per_day?: number;
}

// ============================================================================
// listCampaigns
// ============================================================================

/**
 * List all email campaigns in the account.
 * Auto-paginates to retrieve all campaigns.
 */
export async function listCampaigns(
  params: ListCampaignsInput,
): Promise<ListCampaignsOutput> {
  const { token, status } = params;

  interface CampaignListResponse {
    data: { results: RawCampaign[]; count: number };
  }

  const campaigns = await paginateAll<RawCampaign>(async (offset, limit) => {
    const qs = new URLSearchParams({
      offset: String(offset),
      limit: String(limit),
      parentCampaignId: 'null',
    });

    if (status) {
      qs.set('status', status);
    } else {
      qs.set('statusNot', 'ARCHIVED');
    }

    const res = await apiFetch(
      token,
      `/api/email-campaigns/get-all-campaigns?${qs}`,
    );
    if (!res.ok) {
      throwForStatus(res.status, await res.text().catch(() => undefined));
    }

    const data = (await res.json()) as CampaignListResponse;
    return data.data?.results ?? [];
  });

  return {
    campaigns,
    total: campaigns.length,
  };
}

// ============================================================================
// createCampaign
// ============================================================================

/**
 * Create a new email campaign.
 * Returns the new campaign ID.
 */
export async function createCampaign(
  params: CreateCampaignInput,
): Promise<CreateCampaignOutput> {
  const {
    token,
    name,
    timezone,
    track_settings,
    stop_lead_settings,
    max_leads_per_day,
  } = params;

  const body: CreateCampaignBody = { name };

  if (timezone !== undefined) body.timezone = timezone;
  if (track_settings !== undefined)
    body.track_settings = track_settings.join(',');
  if (stop_lead_settings !== undefined)
    body.stop_lead_settings = stop_lead_settings;
  if (max_leads_per_day !== undefined)
    body.max_leads_per_day = max_leads_per_day;

  const res = await apiFetch(token, '/api/email-campaigns', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throwForStatus(res.status, await res.text().catch(() => undefined));
  }

  const data = (await res.json()) as CreateCampaignResponse;

  return {
    id: data.data.id,
    name: data.data.name,
    status: data.data.status,
  };
}

// ============================================================================
// getCampaign
// ============================================================================

/**
 * Get full details for a single campaign by ID.
 */
export async function getCampaign(
  params: GetCampaignInput,
): Promise<GetCampaignOutput> {
  const { token, id } = params;

  const res = await apiFetch(token, `/api/email-campaigns/${id}`);
  if (!res.ok) {
    throwForStatus(res.status, await res.text().catch(() => undefined));
  }

  interface GetCampaignResponse {
    data: GetCampaignOutput;
  }
  const data = (await res.json()) as GetCampaignResponse;
  return data.data;
}

// ============================================================================
// deleteCampaign
// ============================================================================

/**
 * Permanently delete a campaign by ID.
 */
export async function deleteCampaign(
  params: DeleteCampaignInput,
): Promise<DeleteCampaignOutput> {
  const { token, id } = params;

  const res = await apiFetch(
    token,
    '/api/email-campaigns/delete-email-campaign',
    {
      method: 'POST',
      body: JSON.stringify({ campaignId: id }),
    },
  );

  if (!res.ok) {
    throwForStatus(res.status, await res.text().catch(() => undefined));
  }

  const data = (await res.json()) as { ok?: boolean; message?: string };
  return { ok: data.ok ?? true };
}

// ============================================================================
// resumeCampaign
// ============================================================================

/**
 * Resume a paused campaign, continuing sends from where they left off.
 */
export async function resumeCampaign(
  params: ResumeCampaignInput,
): Promise<ResumeCampaignOutput> {
  const { token, id } = params;

  const res = await apiFetch(token, '/api/email-campaigns/start-campaign', {
    method: 'POST',
    body: JSON.stringify({ campaignId: id }),
  });

  if (!res.ok) {
    throwForStatus(res.status, await res.text().catch(() => undefined));
  }

  const data = (await res.json()) as SimpleOkResponse;
  return { ok: data.ok };
}

// ============================================================================
// getCampaignAnalytics
// ============================================================================

/**
 * Get performance metrics for a campaign.
 */
export async function getCampaignAnalytics(
  params: GetCampaignAnalyticsInput,
): Promise<GetCampaignAnalyticsOutput> {
  const { token, id } = params;

  const res = await apiFetch(token, `/api/email-campaigns/${id}/analytics`);

  if (!res.ok) {
    throwForStatus(res.status, await res.text().catch(() => undefined));
  }

  const data = (await res.json()) as AnalyticsResponse;
  const d = data.data ?? {};

  return {
    sent: d.sent ?? 0,
    open_count: d.open_count ?? 0,
    open_rate: d.open_rate ?? 0,
    click_count: d.click_count ?? 0,
    click_rate: d.click_rate ?? 0,
    reply_count: d.reply_count ?? 0,
    reply_rate: d.reply_rate ?? 0,
    bounce_count: d.bounce_count ?? 0,
    bounce_rate: d.bounce_rate ?? 0,
    unsubscribe_count: d.unsubscribed_count ?? 0,
    unsubscribe_rate: d.unsubscribed_rate ?? 0,
  };
}

// ============================================================================
// GraphQL mutation shared by pauseCampaign and updateCampaign
// ============================================================================

const UPDATE_CAMPAIGN_MUTATION = `
  mutation updateCampaignById($id: Int!, $changes: email_campaigns_set_input!) {
    update_email_campaigns_by_pk(pk_columns: { id: $id }, _set: $changes) {
      id
    }
  }
`;

// ============================================================================
// pauseCampaign
// ============================================================================

/**
 * Pause an active campaign via GraphQL mutation.
 */
export async function pauseCampaign(
  params: PauseCampaignInput,
): Promise<PauseCampaignOutput> {
  const { token, id } = params;

  await gqlFetch(token, UPDATE_CAMPAIGN_MUTATION, {
    id,
    changes: { status: 'PAUSED' },
  });
  return { ok: true };
}

// ============================================================================
// updateCampaign
// ============================================================================

/**
 * Update campaign properties via GraphQL mutation.
 */
export async function updateCampaign(
  params: UpdateCampaignInput,
): Promise<UpdateCampaignOutput> {
  const { token, id, changes } = params;

  await gqlFetch(token, UPDATE_CAMPAIGN_MUTATION, { id, changes });
  return { ok: true };
}
