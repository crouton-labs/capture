import { throwForStatus } from '@vallum/_runtime';
import { apiFetch, unwrapList } from '../helpers';
import type {
  ListCampaignEmailAccountsInput,
  ListCampaignEmailAccountsOutput,
  AddEmailAccountsToCampaignInput,
  AddEmailAccountsToCampaignOutput,
  RemoveEmailAccountFromCampaignInput,
  RemoveEmailAccountFromCampaignOutput,
} from './schemas';

// ============================================================================
// Internal types
// ============================================================================

interface RawEmailAccount {
  id: number;
  email: string;
  from_name?: string | null;
  smtp_host?: string | null;
  status?: string | null;
  warmup_enabled?: boolean | null;
  daily_limit?: number | null;
}

interface SimpleActionResponse {
  ok: boolean;
  message?: string | null;
}

// ============================================================================
// listCampaignEmailAccounts
// ============================================================================

/**
 * List the email accounts currently assigned to send for a specific campaign.
 */
export async function listCampaignEmailAccounts(
  params: ListCampaignEmailAccountsInput,
): Promise<ListCampaignEmailAccountsOutput> {
  const { token, campaignId } = params;

  const res = await apiFetch(
    token,
    `/api/email-campaigns/${campaignId}/email-accounts`,
  );

  if (!res.ok) {
    throwForStatus(res.status, await res.text().catch(() => undefined));
  }

  const data = (await res.json()) as unknown;
  const accounts = unwrapList<RawEmailAccount>(data);

  return {
    accounts,
    total: accounts.length,
  };
}

// ============================================================================
// addEmailAccountsToCampaign
// ============================================================================

/**
 * Assign one or more email accounts to a campaign for sending.
 */
export async function addEmailAccountsToCampaign(
  params: AddEmailAccountsToCampaignInput,
): Promise<AddEmailAccountsToCampaignOutput> {
  const { token, campaignId, emailAccountIds } = params;

  const res = await apiFetch(
    token,
    `/api/email-campaigns/${campaignId}/email-accounts`,
    {
      method: 'POST',
      body: JSON.stringify({ email_account_ids: emailAccountIds }),
    },
  );

  if (!res.ok) {
    throwForStatus(res.status, await res.text().catch(() => undefined));
  }

  const data = (await res.json()) as SimpleActionResponse;
  return { ok: data.ok, message: data.message };
}

// ============================================================================
// removeEmailAccountFromCampaign
// ============================================================================

/**
 * Remove a specific email account from a campaign's sending pool.
 */
export async function removeEmailAccountFromCampaign(
  params: RemoveEmailAccountFromCampaignInput,
): Promise<RemoveEmailAccountFromCampaignOutput> {
  const { token, campaignId, emailAccountId } = params;

  const res = await apiFetch(
    token,
    `/api/email-campaigns/${campaignId}/email-accounts/${emailAccountId}`,
    { method: 'DELETE' },
  );

  if (!res.ok) {
    throwForStatus(res.status, await res.text().catch(() => undefined));
  }

  const data = (await res.json()) as SimpleActionResponse;
  return { ok: data.ok, message: data.message };
}
