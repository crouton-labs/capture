/**
 * Campaign operations
 */

import { ContractDrift, Validation, NotFound } from '@vallum/_runtime';
import { clayFetch, API_BASE } from './shared';
import type {
  ListCampaignsOutput,
  ListCampaignEmailAccountsOutput,
  ListCampaignWebhooksOutput,
  ListSequencerEmailAccountsOutput,
  CreateCampaignInput,
  CreateCampaignOutput,
  CreateCampaignWebhookOutput,
  AddCampaignEmailAccountsInput,
  AddCampaignEmailAccountsOutput,
  AddLeadsToCampaignInput,
  AddLeadsToCampaignOutput,
  RemoveCampaignEmailAccountsInput,
  RemoveCampaignEmailAccountsOutput,
  SetCampaignLeadEmailInput,
  SetCampaignLeadEmailOutput,
  SetCampaignSequenceInput,
  SetCampaignSequenceOutput,
  DeleteCampaignInput,
  DeleteCampaignOutput,
  DeleteCampaignWebhookInput,
  DeleteCampaignWebhookOutput,
  SetCampaignScheduleInput,
  SetCampaignScheduleOutput,
  GetCampaignScheduleInput,
  GetCampaignScheduleOutput,
  GetCampaignAnalyticsInput,
  GetCampaignAnalyticsOutput,
  GetDayWiseAnalyticsInput,
  GetDayWiseAnalyticsOutput,
  GetGlobalCampaignStatsInput,
  GetGlobalCampaignStatsOutput,
  SendTestEmailInput,
  SendTestEmailOutput,
  GetCampaign30dAnalyticsInput,
  GetCampaign30dAnalyticsOutput,
  GetSmartleadAccountInput,
  GetSmartleadAccountOutput,
} from './schemas';

/**
 * List campaigns in a workspace.
 */
export async function listCampaigns(opts: {
  workspaceId: string;
}): Promise<ListCampaignsOutput> {
  const { workspaceId } = opts;

  if (!workspaceId) {
    throw new Validation('workspaceId is required');
  }

  // Fetch both sequencer campaigns and workspace tables in parallel
  // to cross-reference Smartlead IDs with Clay table IDs
  const [seqData, tablesData] = await Promise.all([
    clayFetch<{
      campaigns: Array<{
        id: number;
        name: string;
        status: string;
        created_at: string;
        updated_at: string;
        send_as_plain_text: boolean;
      }>;
    }>(`/workspaces/${workspaceId}/clay-sequencer/campaigns`),
    clayFetch<{
      results: Array<{
        id: string;
        name: string;
        workbookId?: string;
        tableSettings?: Record<string, unknown>;
      }>;
    }>(`/workspaces/${workspaceId}/tables?page=1&limit=100`),
  ]);

  // Build a name→table lookup for MESSAGING tables (campaigns)
  const campaignTablesByName = new Map<
    string,
    { tableId: string; workbookId: string | null }
  >();
  for (const t of tablesData.results || []) {
    if (t.tableSettings?.BLOCK_TYPE === 'MESSAGING') {
      campaignTablesByName.set(t.name, {
        tableId: t.id,
        workbookId: t.workbookId || null,
      });
    }
  }

  // Smartlead has no permanent delete API; stopped campaigns persist forever.
  // When multiple campaigns share a name, only the most recent (highest id)
  // is the real one; older ones are ghosts from previous create/delete cycles.
  const latestByName = new Map<number, boolean>();
  const byName = new Map<string, number>();
  for (const c of seqData.campaigns || []) {
    const existing = byName.get(c.name);
    if (existing === undefined || c.id > existing) {
      if (existing !== undefined) latestByName.set(existing, false);
      byName.set(c.name, c.id);
      latestByName.set(c.id, true);
    } else {
      latestByName.set(c.id, false);
    }
  }

  const campaigns = (seqData.campaigns || [])
    .filter((c) => latestByName.get(c.id) === true)
    .map((c) => {
      const table = campaignTablesByName.get(c.name);
      return {
        id: c.id,
        name: c.name,
        status: c.status,
        created_at: c.created_at,
        updated_at: c.updated_at,
        send_as_plain_text: c.send_as_plain_text,
        tableId: table?.tableId || null,
        workbookId: table?.workbookId || null,
      };
    })
    .filter((c) => c.tableId !== null);

  return {
    campaigns,
    totalCount: campaigns.length,
  };
}

/**
 * Create a new email campaign (table with messaging block type).
 * Creates a table with a Smartlead campaign for email sending.
 */
export async function createCampaign(
  opts: CreateCampaignInput,
): Promise<CreateCampaignOutput> {
  const { workspaceId, name } = opts;

  if (!workspaceId) {
    throw new Validation('workspaceId is required');
  }
  if (!name) {
    throw new Validation('name is required');
  }

  const data = await clayFetch<{
    table: { id: string; name: string; workbookId: string };
  }>('/tables', {
    method: 'POST',
    body: JSON.stringify({
      icon: { emoji: '📧' },
      callerName: 'routing action',
      name,
      template: 'empty',
      type: 'spreadsheet',
      workbookMetadata: { isHiddenFromNavigation: true },
      workspaceId,
      tableSettings: { BLOCK_TYPE: 'MESSAGING', AUTO_RUN_ON: false },
      sourceSettings: {},
    }),
  });

  const table = data.table;

  // Look up the smartlead campaign ID from the sequencer endpoint
  const seq = await clayFetch<{
    campaigns: Array<{ id: number; name: string }>;
  }>(`/workspaces/${workspaceId}/clay-sequencer/campaigns`);
  const match = seq.campaigns.find((c) => c.name === name);

  return {
    id: table.id,
    name: table.name,
    workbookId: table.workbookId,
    smartleadCampaignId: match?.id ?? null,
  };
}

/**
 * Delete a campaign: stops the Smartlead campaign and trashes the Clay table + workbook.
 * Smartlead has no permanent delete API; stopping is the best available cleanup.
 * listCampaigns deduplicates by name so stopped ghosts won't reappear.
 */
export async function deleteCampaign(
  opts: DeleteCampaignInput,
): Promise<DeleteCampaignOutput> {
  const { workspaceId, campaignId, tableId, workbookId } = opts;

  if (!workspaceId) {
    throw new Validation('workspaceId is required');
  }
  if (!campaignId) {
    throw new Validation(
      'campaignId (Smartlead campaign ID) is required. Get it from listCampaigns id field.',
    );
  }

  // Stop the Smartlead campaign (no permanent delete API exists)
  await clayFetch(
    `/workspaces/${workspaceId}/clay-sequencer/campaigns/${campaignId}/status`,
    {
      method: 'PATCH',
      body: JSON.stringify({ status: 'STOPPED' }),
    },
  );

  // Trash the Clay table + workbook if provided
  if (tableId) {
    await clayFetch(`/workspaces/${workspaceId}/resources/`, {
      method: 'DELETE',
      body: JSON.stringify({
        tableIds: [tableId],
        workbookIds: workbookId ? [workbookId] : [],
        folderIds: [],
        isPermanentDelete: true,
      }),
    });
  }

  return { success: true };
}

interface CampaignSettingsResponse {
  status: string;
  scheduler_cron_value: {
    tz: string;
    days: number[];
    startHour: string;
    endHour: string;
  } | null;
  min_time_btwn_emails: number;
  max_leads_per_day: number;
  schedule_start_time: string | null;
  unsubscribe_text: string;
  track_settings: string[];
}

/**
 * Get settings for a campaign (email timing, tracking, unsubscribe text).
 */

/**
 * Get settings for a campaign (email timing, tracking, unsubscribe text).
 */
export async function getCampaignSettings(opts: {
  workspaceId: string;
  campaignId: number;
}): Promise<CampaignSettingsResponse> {
  const { workspaceId, campaignId } = opts;

  if (!workspaceId) {
    throw new Validation('workspaceId is required');
  }
  if (campaignId == null) {
    throw new Validation('campaignId is required');
  }

  const data = await clayFetch<CampaignSettingsResponse>(
    `/workspaces/${workspaceId}/clay-sequencer/campaigns/${campaignId}/settings`,
  );

  return data;
}

/**
 * Update campaign schedule settings (max leads per day, min time between emails).
 * Reads current settings via GET /settings, then patches via PATCH /schedule.
 */
export async function updateCampaignSettings(opts: {
  workspaceId: string;
  campaignId: number;
  maxLeadsPerDay?: number;
  minTimeBtwnEmails?: number;
  timezone?: string;
}): Promise<{
  min_time_btwn_emails: number;
  max_leads_per_day: number;
}> {
  const {
    workspaceId,
    campaignId,
    maxLeadsPerDay,
    minTimeBtwnEmails,
    timezone,
  } = opts;

  if (!workspaceId) {
    throw new Validation('workspaceId is required');
  }
  if (campaignId == null) {
    throw new Validation('campaignId is required');
  }
  if (maxLeadsPerDay == null && minTimeBtwnEmails == null && timezone == null) {
    throw new Validation(
      'At least one of maxLeadsPerDay, minTimeBtwnEmails, or timezone is required',
    );
  }
  if (
    maxLeadsPerDay != null &&
    (maxLeadsPerDay < 1 || maxLeadsPerDay > 10000)
  ) {
    throw new Validation('maxLeadsPerDay must be between 1 and 10000');
  }
  if (minTimeBtwnEmails != null && minTimeBtwnEmails < 5) {
    throw new Validation('minTimeBtwnEmails must be at least 5 minutes');
  }
  if (timezone != null) {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: timezone });
    } catch {
      throw new Validation(
        `Invalid timezone "${timezone}". Must be a valid IANA timezone (e.g., "America/New_York").`,
      );
    }
  }

  // Always read current settings; the /schedule PATCH resets any
  // omitted fields to defaults, so we must send all values every time.
  const current = await clayFetch<CampaignSettingsResponse>(
    `/workspaces/${workspaceId}/clay-sequencer/campaigns/${campaignId}/settings`,
  );

  const body: Record<string, unknown> = {
    timezone:
      timezone ?? current.scheduler_cron_value?.tz ?? 'America/New_York',
    max_new_leads_per_day: maxLeadsPerDay ?? current.max_leads_per_day,
    min_time_btw_emails: minTimeBtwnEmails ?? current.min_time_btwn_emails,
  };

  await clayFetch(
    `/workspaces/${workspaceId}/clay-sequencer/campaigns/${campaignId}/schedule`,
    {
      method: 'PATCH',
      body: JSON.stringify(body),
    },
  );

  // Read back to confirm and return updated values
  const updated = await clayFetch<CampaignSettingsResponse>(
    `/workspaces/${workspaceId}/clay-sequencer/campaigns/${campaignId}/settings`,
  );

  return {
    min_time_btwn_emails: updated.min_time_btwn_emails,
    max_leads_per_day: updated.max_leads_per_day,
  };
}

/**
 * Start, pause, or stop a campaign.
 */

/**
 * Start, pause, or stop a campaign.
 */
export async function updateCampaignStatus(opts: {
  workspaceId: string;
  campaignId: number;
  status: 'START' | 'PAUSED' | 'STOPPED';
}): Promise<{ completedStatusTransition: string }> {
  const { workspaceId, campaignId, status } = opts;

  if (!workspaceId) {
    throw new Validation('workspaceId is required');
  }
  if (campaignId == null) {
    throw new Validation('campaignId is required');
  }
  if (!status) {
    throw new Validation('status is required');
  }

  // Pre-validate START: the Smartlead backend returns 500 if the campaign
  // isn't fully configured. Check for a schedule (the last thing configured
  // in a campaign setup flow) to give an actionable error.
  if (status === 'START') {
    const settings = await clayFetch<CampaignSettingsResponse>(
      `/workspaces/${workspaceId}/clay-sequencer/campaigns/${campaignId}/settings`,
    );
    if (!settings.scheduler_cron_value) {
      throw new Validation(
        `updateCampaignStatus: cannot START campaign ${campaignId}: campaign is not fully configured. ` +
          'Ensure the campaign has a sending schedule, email accounts, a sequence, and a lead email field set up before starting.',
      );
    }
  }

  const data = await clayFetch<{ completedStatusTransition: string }>(
    `/workspaces/${workspaceId}/clay-sequencer/campaigns/${campaignId}/status`,
    {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    },
  );

  return {
    completedStatusTransition: data.completedStatusTransition,
  };
}

/**
 * List email accounts available for the Clay Sequencer.
 */

/**
 * Set the sending schedule for a campaign.
 * Reads current settings first, then PATCHes /schedule.
 * The /schedule PATCH resets omitted fields to defaults, so we must
 * always include max_new_leads_per_day, min_time_btw_emails, and timezone.
 */
export async function setCampaignSchedule(
  opts: SetCampaignScheduleInput,
): Promise<SetCampaignScheduleOutput> {
  const { workspaceId, campaignId, timezone, startHour, endHour, days } = opts;

  if (!workspaceId)
    throw new Validation('setCampaignSchedule: workspaceId is required');
  if (campaignId == null)
    throw new Validation('setCampaignSchedule: campaignId is required');

  // Read current settings so we can preserve fields we're not changing
  const current = await clayFetch<CampaignSettingsResponse>(
    `/workspaces/${workspaceId}/clay-sequencer/campaigns/${campaignId}/settings`,
  );

  const cron = current.scheduler_cron_value;

  const body: Record<string, unknown> = {
    // Always include these to prevent reset
    timezone: timezone ?? cron?.tz ?? 'America/New_York',
    max_new_leads_per_day: current.max_leads_per_day,
    min_time_btw_emails: current.min_time_btwn_emails,
  };

  // Schedule-specific fields; preserve current if not provided
  if (startHour != null) body.start_hour = startHour;
  else if (cron?.startHour) body.start_hour = cron.startHour;

  if (endHour != null) body.end_hour = endHour;
  else if (cron?.endHour) body.end_hour = cron.endHour;

  if (days != null) body.days_of_the_week = days;
  else if (cron?.days) body.days_of_the_week = cron.days;

  await clayFetch(
    `/workspaces/${workspaceId}/clay-sequencer/campaigns/${campaignId}/schedule`,
    {
      method: 'PATCH',
      body: JSON.stringify(body),
    },
  );

  // Read back to confirm
  const updated = await clayFetch<CampaignSettingsResponse>(
    `/workspaces/${workspaceId}/clay-sequencer/campaigns/${campaignId}/settings`,
  );

  const updatedCron = updated.scheduler_cron_value;

  return {
    timezone: updatedCron?.tz ?? null,
    startHour: updatedCron?.startHour ?? null,
    endHour: updatedCron?.endHour ?? null,
    days: updatedCron?.days ?? null,
  };
}

// ============================================================================
// Send Test Email
// ============================================================================

/**
 * Send a test email from a campaign to a custom address.
 * Requires a lead record in the campaign table and a configured sequence step.
 */
export async function sendTestEmail(
  opts: SendTestEmailInput,
): Promise<SendTestEmailOutput> {
  const {
    workspaceId,
    campaignId,
    tableId,
    recordId,
    emailAccountId,
    customEmailAddress,
    leadEmail,
    sequenceStepIndex = 0,
  } = opts;

  if (!workspaceId) throw new Validation('sendTestEmail: workspaceId is required');
  if (campaignId == null)
    throw new Validation('sendTestEmail: campaignId is required');
  if (!tableId) throw new Validation('sendTestEmail: tableId is required');
  if (!recordId) throw new Validation('sendTestEmail: recordId is required');
  if (emailAccountId == null)
    throw new Validation('sendTestEmail: emailAccountId is required');
  if (!customEmailAddress)
    throw new Validation('sendTestEmail: customEmailAddress is required');
  if (!leadEmail) throw new Validation('sendTestEmail: leadEmail is required');

  await clayFetch(`/workspaces/${workspaceId}/clay-sequencer/send-test-email`, {
    method: 'POST',
    body: JSON.stringify({
      campaignId,
      tableId,
      recordId,
      emailAccountId,
      customEmailAddress,
      leadEmail,
      sequenceStepIndex,
    }),
  });

  return { success: true };
}

// ============================================================================
// Credit Reporting
// ============================================================================

/**
 * Get credit usage report.
 */

interface SequencerEmailAccountRaw {
  id: string;
  workspaceId: number;
  email: string;
  displayName: string | null;
  accountType: string;
  smartleadId: string | null;
  smartleadAccountStatus: string;
  profilePictureKey: string | null;
  profilePictureUrl: string | null;
  addedByUserId: string | null;
  onlyShowForOwner: boolean;
  createdAt: string;
  updatedAt: string;
  smartSenderOrderId: string | null;
  smartleadData: {
    id: number;
    created_at: string;
    updated_at: string;
    from_name: string;
    from_email: string;
    type: string;
    message_per_day: number;
    daily_sent_count: number;
    smtp_failure_error: string | null;
    imap_failure_error: string | null;
    signature: string | null;
    warmup_details: {
      status: 'ACTIVE' | 'INACTIVE';
      warmup_reputation: string | null;
      total_sent_count: number;
      total_spam_count: number;
      warmup_created_at?: string;
      warmup_key_id?: string;
      reply_rate?: number;
      blocked_reason?: string | null;
    } | null;
    campaign_count: number;
  };
  addedByUserName: string | null;
  addedByUserEmail: string | null;
  addedByUserProfilePicture: string | null;
}

/**
 * List email accounts available for the Clay Sequencer.
 */
export async function listSequencerEmailAccounts(opts: {
  workspaceId: string;
}): Promise<ListSequencerEmailAccountsOutput> {
  const { workspaceId } = opts;

  if (!workspaceId) {
    throw new Validation('workspaceId is required');
  }

  const data = await clayFetch<SequencerEmailAccountRaw[]>(
    `/workspaces/${workspaceId}/clay-sequencer-email-accounts`,
  );

  const accounts = (Array.isArray(data) ? data : []).map((a) => ({
    id: a.id,
    workspaceId: a.workspaceId,
    email: a.email,
    displayName: a.displayName ?? null,
    accountType: a.accountType,
    smartleadId: a.smartleadId ?? null,
    smartleadAccountStatus: a.smartleadAccountStatus,
    profilePictureKey: a.profilePictureKey ?? null,
    profilePictureUrl: a.profilePictureUrl ?? null,
    addedByUserId: a.addedByUserId ?? null,
    onlyShowForOwner: a.onlyShowForOwner,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    smartSenderOrderId: a.smartSenderOrderId ?? null,
    smartleadData: a.smartleadData,
    addedByUserName: a.addedByUserName ?? null,
    addedByUserEmail: a.addedByUserEmail ?? null,
    addedByUserProfilePicture: a.addedByUserProfilePicture ?? null,
  }));

  return {
    accounts,
    totalCount: accounts.length,
  };
}

/**
 * Get the OAuth URL to connect a Gmail or Microsoft email account to the Clay Sequencer.
 * The user must visit this URL in their browser to authorize Clay.
 */
export async function getEmailAccountConnectUrl(opts: {
  workspaceId: string;
  provider?: 'gmail' | 'microsoft';
}): Promise<{ connectUrl: string }> {
  const { workspaceId, provider = 'gmail' } = opts;

  if (!workspaceId) throw new Validation('workspaceId is required');

  const validProviders = ['gmail', 'microsoft'] as const;
  if (!validProviders.includes(provider as (typeof validProviders)[number])) {
    throw new Validation(
      `getEmailAccountConnectUrl: invalid provider "${provider}". Must be one of: ${validProviders.join(', ')}`,
    );
  }

  const providerKey =
    provider === 'microsoft'
      ? 'clay-sequencer-smartlead-microsoft'
      : 'clay-sequencer-smartlead-gmail';

  return {
    connectUrl: `${API_BASE}/app-accounts/oauth/${providerKey}?workspaceId=${workspaceId}`,
  };
}

/**
 * List all workbooks in a workspace.
 */

/**
 * Add email accounts to a campaign for sending emails.
 */
export async function addCampaignEmailAccounts(
  opts: AddCampaignEmailAccountsInput,
): Promise<AddCampaignEmailAccountsOutput> {
  const { workspaceId, campaignId, emailAccountIds } = opts;

  if (!workspaceId) {
    throw new Validation('addCampaignEmailAccounts: workspaceId is required');
  }
  if (campaignId == null || !Number.isInteger(campaignId) || campaignId <= 0) {
    throw new Validation(
      'addCampaignEmailAccounts: campaignId must be a positive integer',
    );
  }
  if (!emailAccountIds || emailAccountIds.length === 0) {
    throw new Validation(
      'addCampaignEmailAccounts: emailAccountIds is required and must not be empty',
    );
  }
  if (emailAccountIds.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new Validation(
      'addCampaignEmailAccounts: all emailAccountIds must be positive integers',
    );
  }

  await clayFetch(
    `/workspaces/${workspaceId}/clay-sequencer/campaigns/${campaignId}/email-accounts`,
    {
      method: 'POST',
      body: JSON.stringify({ email_account_ids: emailAccountIds }),
    },
  );

  return {
    success: true,
  };
}

/**
 * Add leads to a campaign by creating records in the campaign table and
 * triggering the sequencer action fields to push them to Smartlead.
 */
export async function addLeadsToCampaign(
  opts: AddLeadsToCampaignInput,
): Promise<AddLeadsToCampaignOutput> {
  const { tableId, leads } = opts;

  if (!tableId) {
    throw new Validation('addLeadsToCampaign: tableId is required');
  }
  if (!leads || leads.length === 0) {
    throw new Validation(
      'addLeadsToCampaign: leads array is required and must not be empty',
    );
  }
  if (leads.length > 100) {
    throw new Validation('addLeadsToCampaign: maximum 100 leads per call');
  }

  for (let i = 0; i < leads.length; i++) {
    if (!leads[i].email) {
      throw new Validation(
        `addLeadsToCampaign: lead at index ${i} is missing required email field`,
      );
    }
  }

  // 1. Get table metadata to find email field and action fields
  const tableData = await clayFetch<CampaignTableResponse>(
    `/tables/${tableId}`,
  );
  const table = tableData.table;

  // Find the email field (from tableSettings.LEAD_EMAIL_FIELD_ID or first email-type field)
  const tableSettings = (table.tableSettings || {}) as Record<string, unknown>;
  let emailFieldId = tableSettings.LEAD_EMAIL_FIELD_ID as string | undefined;
  if (!emailFieldId) {
    const emailField = table.fields.find((f) => f.type === 'email');
    if (emailField) emailFieldId = emailField.id;
  }
  if (!emailFieldId) {
    throw new ContractDrift(
      'addLeadsToCampaign: no email field found on campaign table. Call setCampaignLeadEmail first.',
    );
  }

  // Find the sequencer action field IDs
  const groupMap = table.fieldGroupMap || {};
  const seqEntry = Object.entries(groupMap).find(
    ([, v]) => v.type === 'clay_sequencer',
  );
  const groupDetails = seqEntry?.[1]?.groupDetails;
  const validateFieldId = groupDetails?.validateLeadField?.id;
  const addLeadFieldId = groupDetails?.addLeadField?.id;

  // Find the default view
  const defaultViewId =
    table.firstViewId ||
    (table.views && table.views.length > 0 ? table.views[0].id : undefined);

  // 2. Create records in the campaign table with email data
  const records = leads.map((lead) => ({
    cells: { [emailFieldId!]: lead.email },
  }));

  const createResult = await clayFetch<{
    records: Array<{
      id: string;
      tableId: string;
      cells: Record<string, { value: unknown }>;
    }>;
  }>(`/tables/${tableId}/records`, {
    method: 'POST',
    body: JSON.stringify({ records }),
  });

  const createdRecordIds = (createResult.records || []).map((r) => r.id);

  // 3. Trigger the sequencer action fields on the new records
  let actionsTriggered = false;
  const actionFieldIds: string[] = [];
  if (validateFieldId) actionFieldIds.push(validateFieldId);
  if (addLeadFieldId) actionFieldIds.push(addLeadFieldId);

  if (actionFieldIds.length > 0 && defaultViewId) {
    await clayFetch<{ recordCount: number }>(`/tables/${tableId}/run`, {
      method: 'PATCH',
      body: JSON.stringify({
        fieldIds: actionFieldIds,
        runRecords: {
          recordIds: createdRecordIds,
        },
        callerName: 'API',
      }),
    });
    actionsTriggered = true;
  }

  // 4. Initialize per-lead result tracking
  const leadResults: Array<{
    recordId: string;
    email: string;
    validateStatus: string | null;
    addLeadStatus: string | null;
    success: boolean;
  }> = createdRecordIds.map((recordId, i) => ({
    recordId,
    email: leads[i].email,
    validateStatus: null,
    addLeadStatus: null,
    success: false,
  }));

  // 5. Poll action field cell values until all complete or timeout
  if (actionsTriggered) {
    const maxPollTime = 15000;
    const pollInterval = 3000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxPollTime) {
      await new Promise<void>((resolve) => setTimeout(resolve, pollInterval));

      const recordsResp = await clayFetch<{
        results: Array<{
          id: string;
          tableId: string;
          cells: Record<
            string,
            { value: unknown; metadata?: { status?: string } }
          >;
        }>;
      }>(`/tables/${tableId}/bulk-fetch-records`, {
        method: 'POST',
        body: JSON.stringify({
          recordIds: createdRecordIds,
          includeExternalContentFieldIds: [],
        }),
      });

      let allComplete = true;
      for (const result of leadResults) {
        const record = (recordsResp.results ?? []).find(
          (r) => r.id === result.recordId,
        );
        if (!record) {
          allComplete = false;
          continue;
        }

        if (validateFieldId) {
          const cell = record.cells[validateFieldId];
          if (cell?.value != null) {
            result.validateStatus = String(cell.value);
          } else {
            allComplete = false;
          }
        }

        if (addLeadFieldId) {
          const cell = record.cells[addLeadFieldId];
          if (cell?.value != null) {
            result.addLeadStatus = String(cell.value);
          } else {
            allComplete = false;
          }
        }

        result.success =
          !result.validateStatus?.includes('ERROR') &&
          !result.addLeadStatus?.includes('ERROR') &&
          (result.validateStatus != null || result.addLeadStatus != null);
      }

      if (allComplete) break;
    }
  }

  return {
    recordIds: createdRecordIds,
    recordCount: createdRecordIds.length,
    actionsTriggered,
    tableId,
    emailFieldId,
    leadResults,
  };
}

/**
 * Remove email accounts from a campaign.
 */
export async function removeCampaignEmailAccounts(
  opts: RemoveCampaignEmailAccountsInput,
): Promise<RemoveCampaignEmailAccountsOutput> {
  const { workspaceId, campaignId, emailAccountIds } = opts;

  if (!workspaceId) {
    throw new Validation('removeCampaignEmailAccounts: workspaceId is required');
  }
  if (campaignId == null || !Number.isInteger(campaignId) || campaignId <= 0) {
    throw new Validation(
      'removeCampaignEmailAccounts: campaignId must be a positive integer',
    );
  }
  if (!emailAccountIds || emailAccountIds.length === 0) {
    throw new Validation(
      'removeCampaignEmailAccounts: emailAccountIds is required and must not be empty',
    );
  }
  if (emailAccountIds.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new Validation(
      'removeCampaignEmailAccounts: all emailAccountIds must be positive integers',
    );
  }

  await clayFetch(
    `/workspaces/${workspaceId}/clay-sequencer/campaigns/${campaignId}/email-accounts`,
    {
      method: 'DELETE',
      body: JSON.stringify({ email_account_ids: emailAccountIds }),
    },
  );

  return {
    success: true,
  };
}

// ============================================================================
// Clay Sequencer - Campaign Webhooks
// ============================================================================

interface CampaignWebhook {
  id: number;
  name: string;
  webhook_url: string;
  email_campaign_id: number;
  event_types: string[];
  categories: string[];
  created_at: string;
  updated_at: string;
}

/**
 * List webhooks configured for a specific campaign.
 */

interface CampaignEmailAccountRaw {
  id: number;
  created_at: string;
  updated_at: string;
  from_name: string;
  from_email: string;
  type: string;
  message_per_day: number;
  daily_sent_count: number;
  smtp_failure_error: string | null;
  imap_failure_error: string | null;
  signature: string | null;
  warmup_details: {
    status: 'ACTIVE' | 'INACTIVE';
    warmup_reputation: string | null;
    total_sent_count: number;
    total_spam_count: number;
  } | null;
}

interface CampaignEmailAccountsResponse {
  accounts: CampaignEmailAccountRaw[];
}

/**
 * List email accounts assigned to a specific campaign.
 */
export async function listCampaignEmailAccounts(opts: {
  workspaceId: string;
  campaignId: number;
}): Promise<ListCampaignEmailAccountsOutput> {
  const { workspaceId, campaignId } = opts;

  if (!workspaceId) {
    throw new Validation('listCampaignEmailAccounts: workspaceId is required');
  }
  if (campaignId == null) {
    throw new Validation('listCampaignEmailAccounts: campaignId is required');
  }

  const data = await clayFetch<CampaignEmailAccountsResponse>(
    `/workspaces/${workspaceId}/clay-sequencer/campaigns/${campaignId}/email-accounts/list`,
  );

  const accounts = (data.accounts || []).map((a) => ({
    id: a.id,
    createdAt: a.created_at,
    updatedAt: a.updated_at,
    fromName: a.from_name,
    fromEmail: a.from_email,
    type: a.type,
    messagePerDay: a.message_per_day,
    dailySentCount: a.daily_sent_count,
    smtpFailureError: a.smtp_failure_error,
    imapFailureError: a.imap_failure_error,
    signature: a.signature,
    warmupDetails: a.warmup_details
      ? {
          status: a.warmup_details.status,
          warmupReputation: a.warmup_details.warmup_reputation,
          totalSentCount: a.warmup_details.total_sent_count,
          totalSpamCount: a.warmup_details.total_spam_count,
        }
      : null,
  }));

  return {
    accounts,
    totalCount: accounts.length,
  };
}

// ============================================================================
// Campaign Sequence Management
// ============================================================================

/**
 * Set the email sequence steps for a campaign.
 */

/**
 * List webhooks configured for a specific campaign.
 */
export async function listCampaignWebhooks(opts: {
  workspaceId: string;
  campaignId: number;
}): Promise<ListCampaignWebhooksOutput> {
  const { workspaceId, campaignId } = opts;

  if (!workspaceId) {
    throw new Validation('listCampaignWebhooks: workspaceId is required');
  }
  if (campaignId == null) {
    throw new Validation('listCampaignWebhooks: campaignId is required');
  }

  const data = await clayFetch<{ webhooks: CampaignWebhook[] }>(
    `/workspaces/${workspaceId}/clay-sequencer/campaigns/${campaignId}/webhooks`,
  );

  const webhooks = (data.webhooks || []).map((w) => ({
    id: w.id,
    name: w.name,
    webhookUrl: w.webhook_url,
    emailCampaignId: w.email_campaign_id,
    eventTypes: w.event_types,
    categories: w.categories,
    createdAt: w.created_at,
    updatedAt: w.updated_at,
  }));

  return {
    webhooks,
    totalCount: webhooks.length,
  };
}

/**
 * Create a webhook for a campaign to receive notifications on email events.
 */
export async function createCampaignWebhook(opts: {
  workspaceId: string;
  campaignId: number;
  name: string;
  webhookUrl: string;
  eventTypes: string[];
}): Promise<CreateCampaignWebhookOutput> {
  const { workspaceId, campaignId, name, webhookUrl, eventTypes } = opts;

  if (!workspaceId) {
    throw new Validation('createCampaignWebhook: workspaceId is required');
  }
  if (!campaignId) {
    throw new Validation('createCampaignWebhook: campaignId is required');
  }
  if (!name) {
    throw new Validation('createCampaignWebhook: name is required');
  }
  if (!webhookUrl) {
    throw new Validation('createCampaignWebhook: webhookUrl is required');
  }
  if (!eventTypes || eventTypes.length === 0) {
    throw new Validation(
      'createCampaignWebhook: eventTypes is required and must not be empty',
    );
  }

  // POST returns {}; create then fetch the list to return the created webhook
  await clayFetch(
    `/workspaces/${workspaceId}/clay-sequencer/campaigns/${campaignId}/webhooks`,
    {
      method: 'POST',
      body: JSON.stringify({
        name,
        webhook_url: webhookUrl,
        event_types: eventTypes,
      }),
    },
  );

  const data = await clayFetch<{ webhooks: CampaignWebhook[] }>(
    `/workspaces/${workspaceId}/clay-sequencer/campaigns/${campaignId}/webhooks`,
  );

  const webhooks = data.webhooks || [];
  const created = webhooks
    .filter((w) => w.name === name && w.webhook_url === webhookUrl)
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )[0];

  if (!created) {
    throw new ContractDrift(
      'createCampaignWebhook: webhook created but not found in list',
    );
  }

  return {
    id: created.id,
    name: created.name,
    webhookUrl: created.webhook_url,
    emailCampaignId: created.email_campaign_id,
    eventTypes: created.event_types,
    categories: created.categories,
    createdAt: created.created_at,
    updatedAt: created.updated_at,
  };
}

// ============================================================================
// Campaign Analytics and Inbox
// ============================================================================

/**
 * Get analytics for a specific campaign.
 */

/**
 * Delete a webhook from a campaign.
 */
export async function deleteCampaignWebhook(
  opts: DeleteCampaignWebhookInput,
): Promise<DeleteCampaignWebhookOutput> {
  const { workspaceId, campaignId, webhookId } = opts;

  if (!workspaceId)
    throw new Validation('deleteCampaignWebhook: workspaceId is required');
  if (campaignId == null)
    throw new Validation('deleteCampaignWebhook: campaignId is required');
  if (webhookId == null)
    throw new Validation('deleteCampaignWebhook: webhookId is required');

  await clayFetch(
    `/workspaces/${workspaceId}/clay-sequencer/campaigns/${campaignId}/webhooks/${webhookId}`,
    { method: 'DELETE' },
  );

  return { success: true };
}

// ============================================================================
// Lead Management (Inbox)
// ============================================================================

/**
 * Categorize a lead reply in the campaign inbox.
 */

/**
 * Set the email sequence steps for a campaign.
 */
export async function setCampaignSequence(
  opts: SetCampaignSequenceInput,
): Promise<SetCampaignSequenceOutput> {
  const { workspaceId, campaignId, tableId, steps } = opts;

  if (!workspaceId)
    throw new Validation('setCampaignSequence: workspaceId is required');
  if (campaignId == null)
    throw new Validation('setCampaignSequence: campaignId is required');
  if (!tableId) throw new Validation('setCampaignSequence: tableId is required');
  if (!steps || steps.length === 0)
    throw new Validation('setCampaignSequence: at least one step is required');

  // 1. Fetch table metadata to find clay_sequencer group and validate lead field
  const tableData = await clayFetch<{
    table: {
      workspaceId: number;
      fieldGroupMap?: Record<
        string,
        {
          type?: string;
          settings?: Record<string, unknown>;
          groupDetails?: {
            validateLeadField?: { id: string };
            [k: string]: unknown;
          };
        }
      >;
      fields?: Array<{ id: string; groupId?: string | null }>;
    };
  }>(`/tables/${tableId}`);
  const existingGroupMap = tableData.table.fieldGroupMap || {};
  const existingFields = tableData.table.fields || [];

  // Find the clay_sequencer group (required for persisting the sequence)
  const seqEntry = Object.entries(existingGroupMap).find(
    ([, v]) => v.type === 'clay_sequencer',
  );
  if (!seqEntry) {
    throw new ContractDrift(
      `setCampaignSequence: no clay_sequencer field group found on table ${tableId}. Is this a campaign table?`,
    );
  }
  const [seqGroupId, seqGroup] = seqEntry;
  const seqSettings = (seqGroup.settings || {}) as Record<string, unknown>;

  // Get the validate lead field ID for conditionalRunFormulaText
  const validateLeadFieldId =
    seqGroup.groupDetails?.validateLeadField?.id || null;
  const conditionalRunSettings: Record<string, unknown> = {};
  if (validateLeadFieldId) {
    conditionalRunSettings.conditionalRunFormulaText = `{{${validateLeadFieldId}}}.ok === true`;
  }

  // 2. Delete old message_v2 group fields
  const oldMessageGroupIds = new Set<string>();
  for (const [groupId, group] of Object.entries(existingGroupMap)) {
    if (group.type === 'message_v2') {
      oldMessageGroupIds.add(groupId);
    }
  }
  for (const field of existingFields) {
    if (field.groupId && oldMessageGroupIds.has(field.groupId)) {
      await clayFetch(`/tables/${tableId}/fields/${field.id}`, {
        method: 'DELETE',
      });
    }
  }

  // 3. Create new message groups for each step
  const sequence: Array<{
    emailType: string;
    timeDelayDays: number;
    messageGroupId: string;
  }> = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const isOpener = i === 0;
    const emailType = isOpener ? 'NEW_EMAIL_THREAD' : 'REPLY_TO_THREAD';

    const groupData = await clayFetch<{
      fields: Array<{ id: string; groupId?: string }>;
    }>(`/tables/${tableId}/fields/message-group/v2`, {
      method: 'POST',
      body: JSON.stringify({
        name: isOpener ? 'Opener' : `Follow-up ${i}`,
        emailType,
        // Opener gets subject DSL; replies get empty (inherit opener subject)
        subjectFieldDSL: isOpener
          ? [{ type: 'Formula', formula: JSON.stringify(step.subject) }]
          : [],
        bodyFieldDSL: [{ type: 'Formula', formula: JSON.stringify(step.body) }],
        htmlMode: false,
        settings: {
          ...conditionalRunSettings,
        },
      }),
    });

    const groupId = groupData.fields?.[0]?.groupId;
    if (!groupId) {
      throw new ContractDrift(
        `setCampaignSequence: failed to extract groupId from message-group response for step ${i}`,
      );
    }

    sequence.push({
      emailType,
      timeDelayDays: step.timeDelayDays ?? 1,
      messageGroupId: groupId,
    });
  }

  // 4. Persist the sequence to the clay_sequencer group settings.
  // Uses the dedicated /fields/clay-sequencer-group/ endpoint; the
  // generic table PATCH silently drops the sequence array.
  await clayFetch(
    `/workspaces/${workspaceId}/tables/${tableId}/fields/clay-sequencer-group/${seqGroupId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        settings: {
          ...seqSettings,
          sequence,
        },
      }),
    },
  );

  // 5. Set the sequence on the campaign (Smartlead side)
  await clayFetch(
    `/workspaces/${workspaceId}/clay-sequencer/campaigns/${campaignId}/sequences`,
    {
      method: 'POST',
      body: JSON.stringify({ sequence }),
    },
  );

  return { success: true };
}

/**
 * Get the email sequence steps configured on a campaign.
 */
export async function getCampaignSequence(opts: { tableId: string }): Promise<{
  steps: Array<{
    messageGroupId: string;
    name: string;
    emailType: string;
    timeDelayDays: number;
    subject?: string;
    body?: string;
  }>;
}> {
  const { tableId } = opts;

  if (!tableId) throw new Validation('getCampaignSequence: tableId is required');

  // GET /tables/{id} returns {table: {...}, extraData: {...}}
  const rawResponse = await clayFetch<{
    table: {
      fieldGroupMap: Record<
        string,
        {
          type?: string;
          name?: string;
          emailType?: string;
          settings?: {
            sequence?: Array<{
              messageGroupId: string;
              emailType: string;
              timeDelayDays: number;
            }>;
          };
          groupDetails?: {
            subjectField?: {
              id?: string;
              dsl?: Array<{ formula?: string }>;
            } | null;
            bodyField?: {
              id?: string;
              dsl?: Array<{ formula?: string }>;
            } | null;
          };
        }
      >;
    };
  }>(`/tables/${tableId}`);

  const groupMap = rawResponse.table.fieldGroupMap || {};

  // Helper to extract text content from a DSL field
  function extractDslText(
    dsl: Array<{ formula?: string }> | undefined,
  ): string | undefined {
    if (!dsl?.[0]?.formula) return undefined;
    try {
      return JSON.parse(dsl[0].formula);
    } catch {
      return dsl[0].formula;
    }
  }

  // Find the clay_sequencer group for sequence order + timeDelayDays
  const sequencerGroup = Object.values(groupMap).find(
    (g) => g.type === 'clay_sequencer',
  );
  const sequenceOrder = sequencerGroup?.settings?.sequence || [];

  // Primary path: sequence order is populated (has timeDelayDays + ordering)
  if (sequenceOrder.length > 0) {
    const steps = sequenceOrder.map((step) => {
      const messageGroup = step.messageGroupId
        ? groupMap[step.messageGroupId]
        : undefined;

      return {
        messageGroupId: step.messageGroupId,
        name: messageGroup?.name || step.emailType,
        emailType: step.emailType,
        timeDelayDays: step.timeDelayDays,
        subject: extractDslText(messageGroup?.groupDetails?.subjectField?.dsl),
        body: extractDslText(messageGroup?.groupDetails?.bodyField?.dsl),
      };
    });
    return { steps };
  }

  // Fallback: scan message_v2 groups directly. timeDelayDays defaults to
  // 0 because it is only stored in the sequence array (which is empty).
  const steps: Array<{
    messageGroupId: string;
    name: string;
    emailType: string;
    timeDelayDays: number;
    subject?: string;
    body?: string;
  }> = [];

  for (const [groupId, group] of Object.entries(groupMap)) {
    if (group.type !== 'message_v2') continue;

    steps.push({
      messageGroupId: groupId,
      name: group.name || group.emailType || 'NEW_EMAIL_THREAD',
      emailType: group.emailType || 'NEW_EMAIL_THREAD',
      timeDelayDays: 0,
      subject: extractDslText(group.groupDetails?.subjectField?.dsl),
      body: extractDslText(group.groupDetails?.bodyField?.dsl),
    });
  }

  return { steps };
}

// ============================================================================
// Campaign Schedule
// ============================================================================

/**
 * Get the sending schedule for a campaign.
 */
export async function getCampaignSchedule(
  opts: GetCampaignScheduleInput,
): Promise<GetCampaignScheduleOutput> {
  const { workspaceId, campaignId } = opts;

  if (!workspaceId) throw new Validation('workspaceId is required');
  if (campaignId == null) throw new Validation('campaignId is required');

  const data = await clayFetch<CampaignSettingsResponse>(
    `/workspaces/${workspaceId}/clay-sequencer/campaigns/${campaignId}/settings`,
  );

  const cron = data.scheduler_cron_value;

  return {
    status: data.status,
    timezone: cron?.tz ?? null,
    startHour: cron?.startHour ?? null,
    endHour: cron?.endHour ?? null,
    days: cron?.days ?? null,
    maxLeadsPerDay: data.max_leads_per_day,
    minTimeBetweenEmails: data.min_time_btwn_emails,
    scheduleStartTime: data.schedule_start_time,
    unsubscribeText: data.unsubscribe_text,
    trackSettings: data.track_settings,
  };
}

/**
 * Set the sending schedule for a campaign.
 */

/**
 * Get analytics for a specific campaign.
 */
export async function getCampaignAnalytics(
  opts: GetCampaignAnalyticsInput,
): Promise<GetCampaignAnalyticsOutput> {
  const { workspaceId, campaignId } = opts;

  if (!workspaceId) {
    throw new Validation('workspaceId is required');
  }
  if (campaignId == null) {
    throw new Validation('campaignId is required');
  }

  const data = await clayFetch<GetCampaignAnalyticsOutput>(
    `/workspaces/${workspaceId}/clay-sequencer/analytics/campaigns/${campaignId}`,
  );

  return data;
}

/**
 * Get day-by-day email analytics for one or more campaigns.
 */
export async function getDayWiseAnalytics(
  opts: GetDayWiseAnalyticsInput,
): Promise<GetDayWiseAnalyticsOutput> {
  const {
    workspaceId,
    campaignIds,
    startDate,
    endDate,
    timezone = 'America/New_York',
  } = opts;

  if (!workspaceId) {
    throw new Validation('workspaceId is required');
  }
  if (!campaignIds || campaignIds.length === 0) {
    throw new Validation('campaignIds is required');
  }
  if (!startDate) {
    throw new Validation('startDate is required');
  }
  if (!endDate) {
    throw new Validation('endDate is required');
  }

  const data = await clayFetch<GetDayWiseAnalyticsOutput>(
    `/workspaces/${workspaceId}/clay-sequencer/analytics/day-wise`,
    {
      method: 'POST',
      body: JSON.stringify({
        request: {
          campaign_ids: campaignIds.join(','),
          start_date: startDate,
          end_date: endDate,
          timezone,
        },
      }),
    },
  );

  return data;
}

/**
 * List email replies from the global inbox.
 */

/**
 * Get global analytics overview across all campaigns.
 */
export async function getGlobalCampaignStats(
  opts: GetGlobalCampaignStatsInput,
): Promise<GetGlobalCampaignStatsOutput> {
  const { workspaceId, startDate, endDate } = opts;

  if (!workspaceId)
    throw new Validation('getGlobalCampaignStats: workspaceId is required');
  if (!startDate)
    throw new Validation('getGlobalCampaignStats: startDate is required');
  if (!endDate) throw new Validation('getGlobalCampaignStats: endDate is required');

  const data = await clayFetch<{
    campaign_wise_performance?: Array<{
      id: number;
      campaign_name: string;
      sent: number;
      opened: number;
      replied: number;
      bounced: number;
      open_rate?: string;
      reply_rate?: string;
      bounce_rate?: string;
      positive_reply_rate?: string;
      positive_replied?: number;
      unique_lead_count?: number;
      unique_open_count?: number;
    }>;
  }>(
    `/workspaces/${workspaceId}/clay-sequencer/analytics/global/campaign-stats`,
    {
      method: 'POST',
      body: JSON.stringify({
        start_date: startDate,
        end_date: endDate,
        full_data: true,
      }),
    },
  );

  return {
    campaignWisePerformance: (data.campaign_wise_performance || []).map(
      (c) => ({
        id: c.id,
        campaignName: c.campaign_name,
        sent: c.sent,
        opened: c.opened,
        replied: c.replied,
        bounced: c.bounced,
        openRate: c.open_rate,
        replyRate: c.reply_rate,
        bounceRate: c.bounce_rate,
        positiveReplyRate: c.positive_reply_rate,
        positiveReplied: c.positive_replied,
        uniqueLeadCount: c.unique_lead_count,
        uniqueOpenCount: c.unique_open_count,
      }),
    ),
  };
}

// ============================================================================
// Campaign Lead Email Configuration
// ============================================================================

interface TableFieldGroupMap {
  [key: string]: {
    type?: string;
    settings?: {
      smartleadSettings?: { campaignId?: number };
      [key: string]: unknown;
    };
    groupDetails?: {
      addLeadField?: { id: string };
      validateLeadField?: { id: string };
      updateLeadStatusField?: { id: string };
      leadStatusField?: { id: string };
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
}

interface CampaignTableField {
  id: string;
  name: string;
  type: string;
  typeSettings?: {
    actionKey?: string;
    inputsBinding?: Array<{
      name: string;
      formulaText?: string;
      formulaMap?: Record<string, string>;
    }>;
    conditionalRunFormulaText?: string;
    authAccountId?: string;
    actionVersion?: number;
    actionPackageId?: string;
    dataTypeSettings?: { type: string };
    [key: string]: unknown;
  };
  groupId?: string | null;
}

interface CampaignTableResponse {
  table: {
    id: string;
    workspaceId: number;
    workbookId: string;
    tableSettings?: Record<string, unknown>;
    fieldGroupMap: TableFieldGroupMap;
    fields: CampaignTableField[];
    firstViewId?: string;
    views?: Array<{ id: string }>;
  };
  extraData?: unknown;
}

/**
 * Configure which field is used as the lead email address for a campaign.
 * Binds the email field to action fields, sequencer settings, and table
 * deduplication so leads can be added and campaigns can launch.
 */
export async function setCampaignLeadEmail(
  opts: SetCampaignLeadEmailInput,
): Promise<SetCampaignLeadEmailOutput> {
  const { tableId, campaignId, leadEmailFieldId } = opts;

  if (!tableId) throw new Validation('tableId is required');
  if (campaignId == null) throw new Validation('campaignId is required');
  if (!leadEmailFieldId) throw new Validation('leadEmailFieldId is required');

  // 1. Get the campaign table metadata
  const tableData = await clayFetch<CampaignTableResponse>(
    `/tables/${tableId}`,
  );
  const table = tableData.table;
  const groupMap = table.fieldGroupMap || {};

  // 2. Find the clay_sequencer field group
  const seqEntry = Object.entries(groupMap).find(
    ([, v]) => v.type === 'clay_sequencer',
  );
  if (!seqEntry) {
    throw new ContractDrift(
      `setCampaignLeadEmail failed: no clay_sequencer field group found on table ${tableId}`,
    );
  }
  const [seqGroupId, seqGroup] = seqEntry;
  const groupDetails = seqGroup.groupDetails;
  if (!groupDetails) {
    throw new ContractDrift(
      `setCampaignLeadEmail failed: no groupDetails in clay_sequencer group on table ${tableId}`,
    );
  }

  const addLeadFieldId = groupDetails.addLeadField?.id || null;
  const validateLeadFieldId = groupDetails.validateLeadField?.id || null;
  const updateLeadStatusFieldId =
    groupDetails.updateLeadStatusField?.id || null;
  const leadStatusFieldId = groupDetails.leadStatusField?.id || null;

  // 3. Update the "Add lead to campaign" action field
  if (addLeadFieldId) {
    const addLeadField = table.fields.find((f) => f.id === addLeadFieldId);
    if (addLeadField?.typeSettings) {
      const ts = addLeadField.typeSettings;
      // Preserve existing custom_fields mapping (sequence step columns)
      const existingCustomFields =
        (
          ts.inputsBinding as Array<{
            name: string;
            formulaMap?: Record<string, string>;
          }>
        )?.find((b) => b.name === 'custom_fields')?.formulaMap || {};
      await clayFetch(`/tables/${tableId}/fields/${addLeadFieldId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          typeSettings: {
            ...ts,
            inputsBinding: [
              {
                name: 'campaign_id',
                formulaText: String(campaignId),
              },
              {
                name: 'email',
                formulaText: `{{${leadEmailFieldId}}}`,
              },
              { name: 'custom_fields', formulaMap: existingCustomFields },
            ],
          },
        }),
      });
    }
  }

  // 4. Update the "Validate lead input" action field
  if (validateLeadFieldId) {
    const validateField = table.fields.find(
      (f) => f.id === validateLeadFieldId,
    );
    if (validateField?.typeSettings) {
      const ts = validateField.typeSettings;
      const requiredFormulas = JSON.stringify({
        [leadEmailFieldId]: { isLeadEmailFormula: true, dependents: [] },
      });

      await clayFetch(`/tables/${tableId}/fields/${validateLeadFieldId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          typeSettings: {
            ...ts,
            inputsBinding: [
              {
                name: 'required_formulas',
                formulaText: requiredFormulas,
              },
              {
                name: 'lead_formulas',
                formulaMap: {
                  [leadEmailFieldId]: `{{${leadEmailFieldId}}}`,
                },
              },
              {
                name: 'lead_status',
                formulaText: leadStatusFieldId
                  ? `{{${leadStatusFieldId}}}.lead_status`
                  : '',
              },
            ],
          },
        }),
      });
    }
  }

  // 5. Update the "Update lead status" action field
  if (updateLeadStatusFieldId) {
    const updateField = table.fields.find(
      (f) => f.id === updateLeadStatusFieldId,
    );
    if (updateField?.typeSettings) {
      const ts = updateField.typeSettings;
      await clayFetch(`/tables/${tableId}/fields/${updateLeadStatusFieldId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          typeSettings: {
            ...ts,
            inputsBinding: [
              {
                name: 'campaign_id',
                formulaText: String(campaignId),
              },
              {
                name: 'lead_email',
                formulaText: `{{${leadEmailFieldId}}}`,
              },
            ],
          },
        }),
      });
    }
  }

  // 6. Set leadEmailFormula in the sequencer group settings.
  // The generic table PATCH silently drops leadEmailFormula; must use
  // the dedicated clay-sequencer-group endpoint (same as setCampaignSequence).
  const existingSeqSettings = (seqGroup.settings || {}) as Record<
    string,
    unknown
  >;
  await clayFetch(
    `/workspaces/${table.workspaceId}/tables/${tableId}/fields/clay-sequencer-group/${seqGroupId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        settings: {
          ...existingSeqSettings,
          leadEmailFormula: leadEmailFieldId,
        },
      }),
    },
  );

  // 7. Set LEAD_EMAIL_FIELD_ID + DEDUPE_FIELD_ID on table settings
  const existingSettings =
    (table.tableSettings as Record<string, unknown>) || {};
  await clayFetch(`/tables/${tableId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      tableSettings: {
        ...existingSettings,
        DEDUPE_FIELD_ID: leadEmailFieldId,
        LEAD_EMAIL_FIELD_ID: leadEmailFieldId,
        DEDUPE_KEEP_STRATEGY: 'keep_oldest',
      },
    }),
  });

  return {
    success: true,
    addLeadFieldId,
    validateLeadFieldId,
  };
}

/**
 * Get 30-day campaign analytics.
 */
export async function getCampaign30dAnalytics(
  opts: GetCampaign30dAnalyticsInput,
): Promise<GetCampaign30dAnalyticsOutput> {
  const { workspaceId, campaignId } = opts;

  if (!workspaceId) {
    throw new Validation('getCampaign30dAnalytics: workspaceId is required');
  }
  if (campaignId == null) {
    throw new Validation('getCampaign30dAnalytics: campaignId is required');
  }

  const data = await clayFetch<GetCampaign30dAnalyticsOutput>(
    `/workspaces/${workspaceId}/clay-sequencer/analytics/campaigns/${campaignId}`,
  );

  return data;
}

interface AppAccountRaw {
  id: string;
  name: string;
  appAccountTypeId: string;
  isSharedPublicKey: boolean;
  userOwnerId: number | null;
  workspaceOwnerId: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  useStaticIP: boolean;
  reauthInitiatedAt: string | null;
  reauthInitiatedByUserId: number | null;
  obfuscatedCredentials: Record<string, string> | null;
  abilities: {
    canUpdate: boolean;
    canDelete: boolean;
  };
}

/**
 * Get Smartlead integration account details.
 */
export async function getSmartleadAccount(
  opts: GetSmartleadAccountInput,
): Promise<GetSmartleadAccountOutput> {
  const { workspaceId } = opts;

  if (!workspaceId) {
    throw new Validation('getSmartleadAccount: workspaceId is required');
  }

  const data = await clayFetch<AppAccountRaw[]>(
    `/workspaces/${workspaceId}/app-accounts`,
  );

  const accounts = Array.isArray(data) ? data : [];
  const smartlead = accounts.find((a) =>
    a.appAccountTypeId?.startsWith('clay-sequencer-smartlead'),
  );

  if (!smartlead) {
    throw new NotFound(
      'getSmartleadAccount: no Smartlead account found in this workspace',
    );
  }

  return {
    id: smartlead.id,
    name: smartlead.name,
    appAccountTypeId: smartlead.appAccountTypeId,
    isSharedPublicKey: smartlead.isSharedPublicKey,
    userOwnerId: smartlead.userOwnerId ?? null,
    workspaceOwnerId: smartlead.workspaceOwnerId,
    createdAt: smartlead.createdAt,
    updatedAt: smartlead.updatedAt,
    deletedAt: smartlead.deletedAt ?? null,
    useStaticIP: smartlead.useStaticIP,
    reauthInitiatedAt: smartlead.reauthInitiatedAt ?? null,
    reauthInitiatedByUserId: smartlead.reauthInitiatedByUserId ?? null,
    obfuscatedCredentials: smartlead.obfuscatedCredentials ?? null,
    abilities: {
      canUpdate: smartlead.abilities.canUpdate,
      canDelete: smartlead.abilities.canDelete,
    },
  };
}

// ============================================================================
// Workspace Member Invitation
// ============================================================================

/**
 * Invite a new member to the workspace by email.
 */
