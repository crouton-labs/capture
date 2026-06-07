import { throwForStatus } from '@vallum/_runtime';
import { apiFetch, paginateAll } from '../helpers';
import type {
  ListEmailAccountsInput,
  ListEmailAccountsOutput,
  GetEmailAccountInput,
  GetEmailAccountOutput,
  CreateEmailAccountInput,
  CreateEmailAccountOutput,
  UpdateEmailAccountInput,
  UpdateEmailAccountOutput,
  DeleteEmailAccountInput,
  DeleteEmailAccountOutput,
  GetWarmupStatusInput,
  GetWarmupStatusOutput,
  UpdateWarmupSettingsInput,
  UpdateWarmupSettingsOutput,
} from './schemas';

// ============================================================================
// Internal types (not exported — implementation detail)
// ============================================================================

interface RawEmailAccount {
  id: number;
  user_id: number;
  created_at: string;
  updated_at: string;
  from_email: string;
  from_name?: string | null;
  smtp_host?: string | null;
  smtp_port?: number | null;
  imap_host?: string | null;
  imap_port?: number | null;
  username?: string | null;
  type?: string | null;
  status?: string | null;
  warmup_enabled?: boolean | null;
  daily_limit?: number | null;
  reply_to_email?: string | null;
  bcc_email?: string | null;
  message_per_day?: number | null;
  custom_tracking_domain?: string | null;
  client_id?: number | null;
}

interface RawWarmupStatus {
  email_account_id: number;
  warmup_enabled?: boolean | null;
  total_sent?: number | null;
  total_spam?: number | null;
  health_score?: number | null;
  inbox_percent?: number | null;
  spam_percent?: number | null;
  sent_today?: number | null;
  warmup_per_day?: number | null;
}

interface CreateEmailAccountBody {
  from_email: string;
  from_name?: string;
  smtp_host: string;
  smtp_port: number;
  username: string;
  password: string;
  imap_host?: string;
  imap_port?: number;
  imap_username?: string;
  imap_password?: string;
  daily_limit?: number;
  reply_to_email?: string;
}

interface UpdateEmailAccountBody {
  from_name?: string;
  daily_limit?: number;
  reply_to_email?: string;
  bcc_email?: string;
  custom_tracking_domain?: string;
}

interface UpdateWarmupBody {
  warmup_enabled?: boolean;
  warmup_per_day?: number;
  warmup_reply_rate_percent?: number;
  warmup_increase_per_day?: number;
}

// ============================================================================
// listEmailAccounts
// ============================================================================

/**
 * List all email accounts connected to the workspace.
 * Auto-paginates to retrieve all accounts.
 */
export async function listEmailAccounts(
  params: ListEmailAccountsInput,
): Promise<ListEmailAccountsOutput> {
  const { token } = params;

  interface EmailAccountListResponse {
    ok: boolean;
    data: { email_accounts: RawEmailAccount[] };
  }

  const accounts = await paginateAll<RawEmailAccount>(async (offset, limit) => {
    const qs = new URLSearchParams({
      offset: String(offset),
      limit: String(limit),
    });

    const res = await apiFetch(
      token,
      `/api/email-account/get-total-email-accounts?${qs}`,
    );
    if (!res.ok) {
      throwForStatus(res.status, await res.text().catch(() => undefined));
    }

    const data = (await res.json()) as EmailAccountListResponse;
    return data.data?.email_accounts ?? [];
  });

  return {
    accounts,
    total: accounts.length,
  };
}

// ============================================================================
// getEmailAccount
// ============================================================================

/**
 * Get detailed information for a single email account by ID.
 */
export async function getEmailAccount(
  params: GetEmailAccountInput,
): Promise<GetEmailAccountOutput> {
  const { token, id } = params;

  const res = await apiFetch(token, `/api/email-accounts/${id}`);
  if (!res.ok) {
    throwForStatus(res.status, await res.text().catch(() => undefined));
  }

  const data = (await res.json()) as unknown;

  // Unwrap envelope if present
  if (
    data !== null &&
    typeof data === 'object' &&
    'data' in data &&
    (data as { data: unknown }).data !== null &&
    typeof (data as { data: unknown }).data === 'object'
  ) {
    return (data as { data: RawEmailAccount }).data as GetEmailAccountOutput;
  }

  return data as GetEmailAccountOutput;
}

// ============================================================================
// createEmailAccount
// ============================================================================

/**
 * Connect a new email account for sending via SMTP/IMAP credentials.
 */
export async function createEmailAccount(
  params: CreateEmailAccountInput,
): Promise<CreateEmailAccountOutput> {
  const {
    token,
    from_email,
    from_name,
    smtp_host,
    smtp_port,
    smtp_username,
    smtp_password,
    imap_host,
    imap_port,
    imap_username,
    imap_password,
    daily_limit,
    reply_to_email,
  } = params;

  const body: CreateEmailAccountBody = {
    from_email,
    smtp_host,
    smtp_port,
    username: smtp_username,
    password: smtp_password,
  };

  if (from_name !== undefined) body.from_name = from_name;
  if (imap_host !== undefined) body.imap_host = imap_host;
  if (imap_port !== undefined) body.imap_port = imap_port;
  if (imap_username !== undefined) body.imap_username = imap_username;
  if (imap_password !== undefined) body.imap_password = imap_password;
  if (daily_limit !== undefined) body.daily_limit = daily_limit;
  if (reply_to_email !== undefined) body.reply_to_email = reply_to_email;

  const res = await apiFetch(token, '/api/email-accounts', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throwForStatus(res.status, await res.text().catch(() => undefined));
  }

  interface CreateResponse {
    ok: boolean;
    data: { id: number; from_email: string };
  }
  const data = (await res.json()) as CreateResponse;

  return {
    id: data.data.id,
    from_email: data.data.from_email,
  };
}

// ============================================================================
// updateEmailAccount
// ============================================================================

/**
 * Update settings for an email account.
 */
export async function updateEmailAccount(
  params: UpdateEmailAccountInput,
): Promise<UpdateEmailAccountOutput> {
  const {
    token,
    id,
    from_name,
    daily_limit,
    reply_to_email,
    bcc_email,
    custom_tracking_domain,
  } = params;

  const body: UpdateEmailAccountBody = {};
  if (from_name !== undefined) body.from_name = from_name;
  if (daily_limit !== undefined) body.daily_limit = daily_limit;
  if (reply_to_email !== undefined) body.reply_to_email = reply_to_email;
  if (bcc_email !== undefined) body.bcc_email = bcc_email;
  if (custom_tracking_domain !== undefined)
    body.custom_tracking_domain = custom_tracking_domain;

  const res = await apiFetch(token, `/api/email-accounts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throwForStatus(res.status, await res.text().catch(() => undefined));
  }

  return { ok: true, id };
}

// ============================================================================
// deleteEmailAccount
// ============================================================================

/**
 * Disconnect and permanently remove an email account from the workspace.
 */
export async function deleteEmailAccount(
  params: DeleteEmailAccountInput,
): Promise<DeleteEmailAccountOutput> {
  const { token, id } = params;

  const res = await apiFetch(token, `/api/email-accounts/${id}`, {
    method: 'DELETE',
  });

  if (!res.ok) {
    throwForStatus(res.status, await res.text().catch(() => undefined));
  }

  return { ok: true };
}

// ============================================================================
// getWarmupStatus
// ============================================================================

/**
 * Get warmup health score, volume, and inbox placement stats for an email account.
 */
export async function getWarmupStatus(
  params: GetWarmupStatusInput,
): Promise<GetWarmupStatusOutput> {
  const { token, id } = params;

  const res = await apiFetch(token, `/api/email-accounts/${id}/warmup`);
  if (!res.ok) {
    throwForStatus(res.status, await res.text().catch(() => undefined));
  }

  const raw = (await res.json()) as unknown;

  // Unwrap envelope if present
  let warmup: RawWarmupStatus;
  if (
    raw !== null &&
    typeof raw === 'object' &&
    'data' in raw &&
    (raw as { data: unknown }).data !== null &&
    typeof (raw as { data: unknown }).data === 'object'
  ) {
    warmup = (raw as { data: RawWarmupStatus }).data;
  } else {
    warmup = raw as RawWarmupStatus;
  }

  return {
    email_account_id: warmup.email_account_id ?? id,
    warmup_enabled: warmup.warmup_enabled,
    total_sent: warmup.total_sent,
    total_spam: warmup.total_spam,
    health_score: warmup.health_score,
    inbox_percent: warmup.inbox_percent,
    spam_percent: warmup.spam_percent,
    sent_today: warmup.sent_today,
    warmup_per_day: warmup.warmup_per_day,
  };
}

// ============================================================================
// updateWarmupSettings
// ============================================================================

/**
 * Enable/disable warmup for an email account, or adjust warmup intensity.
 */
export async function updateWarmupSettings(
  params: UpdateWarmupSettingsInput,
): Promise<UpdateWarmupSettingsOutput> {
  const {
    token,
    id,
    warmup_enabled,
    warmup_per_day,
    warmup_reply_rate_percent,
    warmup_increase_per_day,
  } = params;

  const body: UpdateWarmupBody = {};
  if (warmup_enabled !== undefined) body.warmup_enabled = warmup_enabled;
  if (warmup_per_day !== undefined) body.warmup_per_day = warmup_per_day;
  if (warmup_reply_rate_percent !== undefined)
    body.warmup_reply_rate_percent = warmup_reply_rate_percent;
  if (warmup_increase_per_day !== undefined)
    body.warmup_increase_per_day = warmup_increase_per_day;

  const res = await apiFetch(token, `/api/email-accounts/${id}/warmup`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throwForStatus(res.status, await res.text().catch(() => undefined));
  }

  return { ok: true, id };
}
