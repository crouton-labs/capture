import { throwForStatus } from '@vallum/_runtime';
import { apiFetch } from '../helpers';
import type {
  GetCampaignPerformanceInput,
  GetCampaignPerformanceOutput,
} from './schemas';

// ============================================================================
// Internal response types
// ============================================================================

interface CampaignPerformanceResponse {
  data: GetCampaignPerformanceOutput;
}

// ============================================================================
// getCampaignPerformance
// ============================================================================

/**
 * Get aggregate campaign performance metrics. Pro+ only.
 */
export async function getCampaignPerformance(
  params: GetCampaignPerformanceInput,
): Promise<GetCampaignPerformanceOutput> {
  const { token, campaignId } = params;

  const qs = new URLSearchParams();
  if (campaignId !== undefined) {
    qs.set('campaignId', String(campaignId));
  }

  const endpoint = `/api/analytics/campaign-performance${qs.toString() ? `?${qs}` : ''}`;
  const res = await apiFetch(token, endpoint);

  if (!res.ok) {
    throwForStatus(res.status, await res.text().catch(() => undefined));
  }

  const body = (await res.json()) as CampaignPerformanceResponse;
  return body.data;
}
