/**
 * Instantly Library
 *
 * Browser-executable Instantly.ai operations via internal APIs.
 * Requires user to be logged into Instantly at app.instantly.ai.
 */

export type {
  User,
  Organization,
  AuthContext,
  Campaign,
  CampaignWithTags,
  Lead,
  LeadStatus,
  EmailAccount,
  CampaignAnalytics,
  UniboxEmail,
  EmailDetail,
  Tag,
  Task,
  CampaignEmail,
  SequenceVariant,
  SequenceStep,
  CampaignSchedule,
  WorkspaceMember,
  LeadLabel,
  ListItem,
  StepInfo,
  GetContextInput,
  ListCampaignsInput,
  GetCampaignInput,
  GetCampaignStatusInput,
  LaunchCampaignInput,
  PauseCampaignInput,
  CreateCampaignInput,
  DeleteCampaignInput,
  UpdateCampaignInput,
  ListCampaignEmailsInput,
  SetCampaignSequenceInput,
  SetCampaignAccountsInput,
  SetCampaignScheduleInput,
  ListLeadsInput,
  AddLeadsInput,
  UpdateLeadStatusInput,
  DeleteLeadInput,
  SearchLeadsInput,
  GetLeadByEmailInput,
  MoveLeadsInput,
  ListLeadLabelsInput,
  ListListsInput,
  ListTagsInput,
  CreateTagInput,
  DeleteTagInput,
  ListTasksInput,
  CreateTaskInput,
  UpdateTaskInput,
  DeleteTaskInput,
  ListAccountsInput,
  GetAccountStatusInput,
  EnableWarmupInput,
  PauseWarmupInput,
  UpdateAccountInput,
  TestSmtpConnectionInput,
  TestImapConnectionInput,
  GetCampaignAnalyticsInput,
  GetAnalyticsSummaryInput,
  GetStepAnalyticsInput,
  GetCrmStatsInput,
  GetCreditsInput,
  GetUnreadCountInput,
  ListEmailsInput,
  GetEmailDetailInput,
  SendEmailInput,
  ReplyToEmailInput,
  MarkEmailReadInput,
  ListWorkspaceMembersInput,
  GetOrganizationDataInput,
  GetContextOutput,
  ListCampaignsOutput,
  GetCampaignOutput,
  GetCampaignStatusOutput,
  LaunchCampaignOutput,
  PauseCampaignOutput,
  CreateCampaignOutput,
  DeleteCampaignOutput,
  UpdateCampaignOutput,
  ListCampaignEmailsOutput,
  SetCampaignSequenceOutput,
  SetCampaignAccountsOutput,
  SetCampaignScheduleOutput,
  ListLeadsOutput,
  AddLeadsOutput,
  UpdateLeadStatusOutput,
  DeleteLeadOutput,
  SearchLeadsOutput,
  GetLeadByEmailOutput,
  MoveLeadsOutput,
  ListLeadLabelsOutput,
  ListListsOutput,
  ListTagsOutput,
  CreateTagOutput,
  DeleteTagOutput,
  ListTasksOutput,
  CreateTaskOutput,
  UpdateTaskOutput,
  DeleteTaskOutput,
  ListAccountsOutput,
  GetAccountStatusOutput,
  EnableWarmupOutput,
  PauseWarmupOutput,
  UpdateAccountOutput,
  TestSmtpConnectionOutput,
  TestImapConnectionOutput,
  GetCampaignAnalyticsOutput,
  GetAnalyticsSummaryOutput,
  GetStepAnalyticsOutput,
  GetCrmStatsOutput,
  GetCreditsOutput,
  GetUnreadCountOutput,
  ListEmailsOutput,
  GetEmailDetailOutput,
  SendEmailOutput,
  ReplyToEmailOutput,
  MarkEmailReadOutput,
  ListWorkspaceMembersOutput,
  GetOrganizationDataOutput,
} from './schemas';

import { Validation, throwForStatus } from '@vallum/_runtime';

import type {
  AuthContext,
  LeadStatus,
  GetContextOutput,
  ListCampaignsOutput,
  GetCampaignOutput,
  GetCampaignStatusOutput,
  LaunchCampaignOutput,
  PauseCampaignOutput,
  CreateCampaignOutput,
  DeleteCampaignOutput,
  UpdateCampaignOutput,
  ListCampaignEmailsOutput,
  SetCampaignSequenceOutput,
  SetCampaignAccountsOutput,
  SetCampaignScheduleOutput,
  ListLeadsOutput,
  AddLeadsOutput,
  UpdateLeadStatusOutput,
  DeleteLeadOutput,
  SearchLeadsOutput,
  GetLeadByEmailOutput,
  MoveLeadsOutput,
  ListLeadLabelsOutput,
  ListListsOutput,
  ListTagsOutput,
  CreateTagOutput,
  DeleteTagOutput,
  ListTasksOutput,
  CreateTaskOutput,
  UpdateTaskOutput,
  DeleteTaskOutput,
  ListAccountsOutput,
  GetAccountStatusOutput,
  EnableWarmupOutput,
  PauseWarmupOutput,
  UpdateAccountOutput,
  TestSmtpConnectionOutput,
  TestImapConnectionOutput,
  GetCampaignAnalyticsOutput,
  GetAnalyticsSummaryOutput,
  GetStepAnalyticsOutput,
  GetCrmStatsOutput,
  GetCreditsOutput,
  GetUnreadCountOutput,
  ListEmailsOutput,
  GetEmailDetailOutput,
  SendEmailOutput,
  ReplyToEmailOutput,
  MarkEmailReadOutput,
  ListWorkspaceMembersOutput,
  GetOrganizationDataOutput,
} from './schemas';

// ============================================================================
// Internal Helpers
// ============================================================================

const BACKEND_ALT_BASE = 'https://app.instantly.ai/backend-alt/api/v1';
const API_ALT_BASE = 'https://app.instantly.ai/api-alt';
const IAPI_ALT_BASE = 'https://iapi-alt.instantly.ai/api/v1';
const BACKEND_V2_BASE = 'https://app.instantly.ai/backend/api/v2';
const GAPI_BASE = 'https://app.instantly.ai/gapi/iapi';

// Extracts auth context from either nested { auth: { ... } } or flat { orgAuth, organizationId }
function extractAuth(opts: Record<string, unknown>): AuthContext {
  if (opts.auth && typeof opts.auth === 'object') {
    const auth = opts.auth as AuthContext;
    if (!auth.orgAuth) {
      throw new Validation('auth.orgAuth is required');
    }
    return auth;
  }
  // Flat pattern from getContext() spread
  if (opts.orgAuth && typeof opts.orgAuth === 'string') {
    const organizationId = opts.organizationId;
    if (typeof organizationId !== 'string') {
      throw new Validation('organizationId is required');
    }
    return {
      orgAuth: opts.orgAuth as string,
      organizationId: organizationId,
    };
  }
  throw new Validation('Auth context required. Call getContext() first.');
}

async function backendAltFetch(
  auth: AuthContext,
  endpoint: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${BACKEND_ALT_BASE}${endpoint}`;
  return fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      'X-Org-Auth': auth.orgAuth,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
}

async function backendV2Fetch(
  auth: AuthContext,
  endpoint: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${BACKEND_V2_BASE}${endpoint}`;
  return fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      'x-workspace-id': auth.organizationId,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
}

// ============================================================================
// Context Acquisition
// ============================================================================

interface UserDetailsResponse {
  id: string;
  email: string;
  name?: { first?: string; last?: string };
  organization_list?: string[];
}

/**
 * Get Instantly session context, auth tokens, and user information.
 * Call this FIRST before any Instantly operations.
 */
export async function getContext(): Promise<GetContextOutput> {
  try {
    const orgAuth = localStorage.getItem('organizationAuth');
    const organizationId = localStorage.getItem('organizationId');

    if (!orgAuth || !organizationId) {
      return {
        success: true,
        isLoggedIn: false,
        currentUrl: window.location.href,
        error:
          'Auth tokens not found in localStorage. User may not be logged in.',
      };
    }

    // Verify login by fetching user details
    const userResp = await fetch(`${API_ALT_BASE}/user/user_details`, {
      credentials: 'include',
    });

    if (!userResp.ok) {
      return {
        success: true,
        isLoggedIn: false,
        currentUrl: window.location.href,
        error: 'Failed to fetch user details',
      };
    }

    const userData: UserDetailsResponse = await userResp.json();

    return {
      success: true,
      isLoggedIn: true,
      currentUrl: window.location.href,
      userId: userData.id,
      organizationId: organizationId,
      orgAuth: orgAuth,
      user: {
        id: userData.id,
        email: userData.email,
        firstName: userData.name?.first,
        lastName: userData.name?.last,
        organizationId: organizationId,
      },
    };
  } catch (err) {
    return {
      success: false,
      isLoggedIn: false,
      currentUrl: window.location.href,
      error: (err as Error).message,
    };
  }
}

// ============================================================================
// Campaigns
// ============================================================================

interface CampaignApiResponse {
  id: string;
  name: string;
  status: number;
  timestamp_created: string;
  tags?: Array<{
    id: string;
    label: string;
    color?: string;
    timestamp_created?: string;
  }>;
}

/**
 * List all campaigns in the organization.
 */
export async function listCampaigns(opts: {
  auth?: AuthContext;
  orgAuth?: string;
  organizationId?: string;
  search?: string;
  status?: number;
  limit?: number;
  skip?: number;
}): Promise<ListCampaignsOutput> {
  const auth = extractAuth(opts);
  const { search, status, limit = 50, skip = 0 } = opts;

  const body: Record<string, unknown> = {
    limit,
    skip,
    search: search !== undefined ? search : '',
    status: status !== undefined ? status : null,
    include_tags: true,
    tag: null,
    sortColumn: 'timestamp_created',
    sortOrder: 'desc',
  };

  const resp = await backendAltFetch(auth, '/campaign/list', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }

  const data: CampaignApiResponse[] = await resp.json();

  return {
    campaigns: data.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      timestampCreated: c.timestamp_created,
      tags: c.tags?.map((t) => ({
        id: t.id,
        label: t.label,
        color: t.color,
        timestampCreated: t.timestamp_created,
      })),
    })),
  };
}

/**
 * Get full details for a campaign including sequence steps, accounts, and schedule.
 */
export async function getCampaign(opts: {
  auth?: AuthContext;
  orgAuth?: string;
  organizationId?: string;
  campaignId: string;
}): Promise<GetCampaignOutput> {
  const auth = extractAuth(opts);
  const { campaignId } = opts;

  const resp = await backendV2Fetch(auth, `/campaigns/${campaignId}`, {
    method: 'GET',
  });

  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }

  const data = await resp.json();

  // Map sequences from API format to our schema format
  let sequences: GetCampaignOutput['sequences'];
  if (data.sequences && Array.isArray(data.sequences)) {
    sequences = data.sequences.map(
      (seq: { steps?: Array<Record<string, unknown>> }) => ({
        steps: (seq.steps || []).map((step: Record<string, unknown>) => ({
          type: (step.type as string) || 'email',
          delay: (step.delay as number) || 0,
          delayUnit: (step.delay_unit as string) || 'days',
          variants: Array.isArray(step.variants)
            ? step.variants.map((v: Record<string, unknown>) => ({
                subject: (v.subject as string) || '',
                body: (v.body as string) || '',
              }))
            : [],
        })),
      }),
    );
  }

  // Map campaign schedule
  let campaignSchedule: GetCampaignOutput['campaignSchedule'];
  if (data.campaign_schedule) {
    const sched = data.campaign_schedule;
    campaignSchedule = {
      name: sched.name,
      timezone: sched.timezone,
      days: sched.days,
      startHour: sched.start_hour,
      endHour: sched.end_hour,
    };
  }

  return {
    id: data.id,
    name: data.name,
    status: data.status,
    timestampCreated: data.timestamp_created,
    timestampUpdated: data.timestamp_updated,
    sequences,
    emailList: data.email_list,
    campaignSchedule,
    dailyLimit: data.daily_limit,
    emailGap: data.email_gap,
    stopOnReply: data.stop_on_reply,
    textOnly: data.text_only,
    linkTracking: data.link_tracking,
    openTracking: data.open_tracking,
  };
}

const CAMPAIGN_STATUS_LABELS: Record<number, string> = {
  0: 'draft',
  1: 'active',
  2: 'paused',
  3: 'completed',
};

/**
 * Get the current status of a campaign.
 */
export async function getCampaignStatus(opts: {
  auth?: AuthContext;
  orgAuth?: string;
  organizationId?: string;
  campaignId: string;
}): Promise<GetCampaignStatusOutput> {
  const auth = extractAuth(opts);
  const { campaignId } = opts;

  // Reuse getCampaign to get the status
  const campaign = await getCampaign({ auth, campaignId });
  const status = campaign.status;

  const statusLabel = CAMPAIGN_STATUS_LABELS[status];
  return {
    campaignId,
    status,
    statusLabel: statusLabel !== undefined ? statusLabel : 'unknown',
  };
}

/**
 * Launch/activate a campaign to start sending emails.
 */
export async function launchCampaign(opts: {
  auth?: AuthContext;
  orgAuth?: string;
  organizationId?: string;
  campaignId: string;
}): Promise<LaunchCampaignOutput> {
  const auth = extractAuth(opts);
  const { campaignId } = opts;

  const resp = await backendAltFetch(auth, '/campaign/launch', {
    method: 'POST',
    body: JSON.stringify({ campaign_id: campaignId }),
  });

  if (!resp.ok) {
    const errorData = await resp.json().catch(() => ({}));
    const errorMsg = errorData.error
      ? errorData.error
      : `Launch failed: ${resp.status}`;
    return {
      success: false,
      campaignId,
      status: 0,
      error: errorMsg,
    };
  }

  const data = await resp.json();
  const newStatus = typeof data.status === 'number' ? data.status : 1;

  return {
    success: true,
    campaignId,
    status: newStatus,
  };
}

/**
 * Pause an active campaign.
 */
export async function pauseCampaign(opts: {
  auth?: AuthContext;
  orgAuth?: string;
  organizationId?: string;
  campaignId: string;
}): Promise<PauseCampaignOutput> {
  const auth = extractAuth(opts);
  const { campaignId } = opts;

  const resp = await backendAltFetch(auth, '/campaign/pause', {
    method: 'POST',
    body: JSON.stringify({ campaign_id: campaignId }),
  });

  if (!resp.ok) {
    const errorData = await resp.json().catch(() => ({}));
    const errorMsg = errorData.error
      ? errorData.error
      : `Pause failed: ${resp.status}`;
    return {
      success: false,
      campaignId,
      status: 1,
      error: errorMsg,
    };
  }

  const data = await resp.json();
  const newStatus = typeof data.status === 'number' ? data.status : 2;

  return {
    success: true,
    campaignId,
    status: newStatus,
  };
}

/**
 * Create a new campaign.
 */
export async function createCampaign(opts: {
  auth?: AuthContext;
  orgAuth?: string;
  organizationId?: string;
  name: string;
  schedule?: Record<string, unknown>;
}): Promise<CreateCampaignOutput> {
  const auth = extractAuth(opts);
  const { name, schedule } = opts;

  const body: Record<string, unknown> = { name };
  if (schedule) {
    body.schedule = schedule;
  }

  const resp = await backendAltFetch(auth, '/campaign/create', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }

  const data = await resp.json();

  return {
    id: data.id,
    name: data.payload?.name || data.name,
    status: data.status,
    timestampCreated: data.timestamp_created,
  };
}

/**
 * Delete a campaign.
 */
export async function deleteCampaign(opts: {
  auth?: AuthContext;
  orgAuth?: string;
  organizationId?: string;
  campaignId: string;
}): Promise<DeleteCampaignOutput> {
  const auth = extractAuth(opts);
  const { campaignId } = opts;

  const resp = await backendAltFetch(auth, '/campaign/delete', {
    method: 'POST',
    body: JSON.stringify({ campaign_id: campaignId }),
  });

  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }

  return {
    success: true,
  };
}

/**
 * Update a campaign (name, settings, etc.).
 */
export async function updateCampaign(opts: {
  auth?: AuthContext;
  orgAuth?: string;
  organizationId?: string;
  campaignId: string;
  fields: Record<string, unknown>;
}): Promise<UpdateCampaignOutput> {
  const auth = extractAuth(opts);
  const { campaignId, fields } = opts;

  const resp = await backendV2Fetch(auth, `/campaigns/${campaignId}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  });

  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }

  const data = await resp.json();

  return {
    id: data.id,
    name: data.name,
    status: data.status,
    timestampCreated: data.timestamp_created,
    timestampUpdated: data.timestamp_updated,
  };
}

/**
 * List the email steps in a campaign sequence with subject, body, and delay info.
 * Reads from the campaign's sequences field (the v2/emails endpoint is non-functional).
 */
export async function listCampaignEmails(opts: {
  auth?: AuthContext;
  orgAuth?: string;
  organizationId?: string;
  campaignId: string;
}): Promise<ListCampaignEmailsOutput> {
  const auth = extractAuth(opts);
  const { campaignId } = opts;

  const campaign = await getCampaign({ auth, campaignId });

  const emails: ListCampaignEmailsOutput['emails'] = [];

  if (campaign.sequences && campaign.sequences.length > 0) {
    const seq = campaign.sequences[0];
    for (let i = 0; i < seq.steps.length; i++) {
      const step = seq.steps[i];
      const primaryVariant = step.variants[0];
      emails.push({
        stepNumber: i + 1,
        subject: primaryVariant?.subject ?? '',
        body: primaryVariant?.body ?? '',
        delay: step.delay,
        delayUnit: step.delayUnit,
        variantCount: step.variants.length,
      });
    }
  }

  return { emails };
}

/**
 * Create or replace the email sequence steps on a campaign.
 */
export async function setCampaignSequence(opts: {
  auth?: AuthContext;
  orgAuth?: string;
  organizationId?: string;
  campaignId: string;
  steps: Array<{
    subject: string;
    body: string;
    delay?: number;
    delayUnit?: 'days' | 'hours' | 'minutes';
    variants?: Array<{ subject: string; body: string }>;
  }>;
}): Promise<SetCampaignSequenceOutput> {
  const auth = extractAuth(opts);
  const { campaignId, steps } = opts;

  if (!steps || steps.length === 0) {
    throw new Validation('At least one step is required');
  }

  // Transform to API format: each step has variants array where first variant is the primary
  const apiSteps = steps.map((step, i) => {
    const allVariants = [{ subject: step.subject, body: step.body }];
    if (step.variants) {
      allVariants.push(...step.variants);
    }
    return {
      type: 'email',
      delay: step.delay !== undefined ? step.delay : i === 0 ? 0 : 1,
      delay_unit: step.delayUnit || 'days',
      variants: allVariants,
    };
  });

  const resp = await backendV2Fetch(auth, `/campaigns/${campaignId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      sequences: [{ steps: apiSteps }],
    }),
  });

  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }

  return {
    success: true,
    campaignId,
    stepCount: steps.length,
  };
}

/**
 * Assign sending email accounts to a campaign for inbox rotation.
 */
export async function setCampaignAccounts(opts: {
  auth?: AuthContext;
  orgAuth?: string;
  organizationId?: string;
  campaignId: string;
  emails: string[];
}): Promise<SetCampaignAccountsOutput> {
  const auth = extractAuth(opts);
  const { campaignId, emails } = opts;

  if (!emails || emails.length === 0) {
    throw new Validation('At least one email account is required');
  }

  const resp = await backendV2Fetch(auth, `/campaigns/${campaignId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      email_list: emails,
    }),
  });

  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }

  return {
    success: true,
    campaignId,
    accountCount: emails.length,
  };
}

/**
 * Configure when a campaign sends emails (days, hours, timezone).
 */
export async function setCampaignSchedule(opts: {
  auth?: AuthContext;
  orgAuth?: string;
  organizationId?: string;
  campaignId: string;
  timezone: string;
  days: Record<string, boolean>;
  fromTime: string;
  toTime: string;
  scheduleName?: string;
}): Promise<SetCampaignScheduleOutput> {
  const auth = extractAuth(opts);
  const { campaignId, timezone, days, fromTime, toTime, scheduleName } = opts;

  const resp = await backendV2Fetch(auth, `/campaigns/${campaignId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      campaign_schedule: {
        schedules: [
          {
            name: scheduleName || 'Default',
            timezone,
            days,
            timing: { from: fromTime, to: toTime },
          },
        ],
      },
    }),
  });

  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }

  return {
    success: true,
    campaignId,
  };
}

// ============================================================================
// Lead Functions
// ============================================================================

interface ApiLeadItem {
  id: string;
  timestamp_created: string;
  timestamp_updated: string;
  organization: string;
  campaign: string;
  status: number;
  payload: {
    email: string;
    first_name?: string;
    last_name?: string;
    company_name?: string;
  };
  contact: string;
  lt_interest_status: number | null;
  company_domain: string | null;
  email_open_count: number;
  email_reply_count: number;
  email_click_count: number;
}

function mapLead(item: ApiLeadItem) {
  return {
    id: item.id,
    email: item.payload?.email || item.contact,
    firstName: item.payload?.first_name,
    lastName: item.payload?.last_name,
    companyName: item.payload?.company_name,
    companyDomain: item.company_domain || undefined,
    status: item.status,
    interestStatus: item.lt_interest_status,
    timestampCreated: item.timestamp_created,
    emailOpenCount: item.email_open_count || 0,
    emailReplyCount: item.email_reply_count || 0,
    emailClickCount: item.email_click_count || 0,
  };
}

/**
 * List leads in a campaign with optional search filter.
 */
export async function listLeads(opts: {
  auth?: AuthContext;
  orgAuth?: string;
  organizationId?: string;
  campaignId: string;
  search?: string;
  limit?: number;
  skip?: number;
}): Promise<ListLeadsOutput> {
  const auth = extractAuth(opts);
  const { campaignId, search, limit = 50, skip = 0 } = opts;

  const body: Record<string, unknown> = {
    campaign_id: campaignId,
    limit,
    skip,
  };

  if (search) {
    body.search = search;
  }

  const resp = await backendAltFetch(auth, '/lead/list', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }

  const data: { items: ApiLeadItem[] } = await resp.json();

  return {
    leads: (data.items || []).map(mapLead),
  };
}

/**
 * Add leads to a campaign.
 */
export async function addLeads(opts: {
  auth?: AuthContext;
  orgAuth?: string;
  organizationId?: string;
  campaignId: string;
  leads: Array<{
    email: string;
    first_name?: string;
    last_name?: string;
    company_name?: string;
    phone?: string;
    website?: string;
    custom_variables?: Record<string, string>;
  }>;
}): Promise<AddLeadsOutput> {
  const auth = extractAuth(opts);
  const { campaignId, leads } = opts;

  if (!leads || leads.length === 0) {
    throw new Validation('At least one lead is required');
  }

  const resp = await backendAltFetch(auth, '/lead/add', {
    method: 'POST',
    body: JSON.stringify({
      campaign_id: campaignId,
      leads: leads,
    }),
  });

  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }

  const data = await resp.json();

  return {
    success: data.status === 'success',
    leadsUploaded: data.leads_uploaded || 0,
    alreadyInCampaign: data.already_in_campaign || 0,
    inBlocklist: data.in_blocklist || 0,
    invalidEmailCount: data.invalid_email_count || 0,
    duplicateEmailCount: data.duplicate_email_count || 0,
    remainingInPlan: data.remaining_in_plan || 0,
  };
}

/**
 * Update the interest status of a lead.
 */
export async function updateLeadStatus(opts: {
  auth?: AuthContext;
  orgAuth?: string;
  organizationId?: string;
  campaignId: string;
  email: string;
  status: LeadStatus;
}): Promise<UpdateLeadStatusOutput> {
  const auth = extractAuth(opts);
  const { campaignId, email, status } = opts;

  const resp = await backendAltFetch(auth, '/lead/update/status', {
    method: 'POST',
    body: JSON.stringify({
      campaign_id: campaignId,
      email: email,
      new_status: status,
    }),
  });

  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }

  const data = await resp.json();

  return {
    success: data.status === 'success',
    message: data.details,
  };
}

/**
 * Delete leads from a campaign.
 */
export async function deleteLead(opts: {
  auth?: AuthContext;
  orgAuth?: string;
  organizationId?: string;
  campaignId: string;
  emails: string[];
}): Promise<DeleteLeadOutput> {
  const auth = extractAuth(opts);
  const { campaignId, emails } = opts;

  if (!emails || emails.length === 0) {
    throw new Validation('At least one email is required');
  }

  const resp = await backendAltFetch(auth, '/lead/delete', {
    method: 'POST',
    body: JSON.stringify({
      campaign_id: campaignId,
      delete_list: emails,
    }),
  });

  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }

  const data = await resp.json();

  return {
    success: data.status === 'success',
    deletedCount: data.deleted || 0,
  };
}

/**
 * Search for leads within a campaign.
 */
export async function searchLeads(opts: {
  auth?: AuthContext;
  orgAuth?: string;
  organizationId?: string;
  campaignId: string;
  query: string;
  limit?: number;
  skip?: number;
}): Promise<SearchLeadsOutput> {
  const auth = extractAuth(opts);
  const { campaignId, query, limit = 50, skip = 0 } = opts;

  // Search uses the same list endpoint with search parameter
  const resp = await backendAltFetch(auth, '/lead/list', {
    method: 'POST',
    body: JSON.stringify({
      campaign_id: campaignId,
      search: query,
      limit,
      skip,
    }),
  });

  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }

  const data: { items: ApiLeadItem[] } = await resp.json();

  return {
    leads: (data.items || []).map(mapLead),
  };
}

/**
 * Look up a lead by email address across all campaigns.
 */
export async function getLeadByEmail(opts: {
  auth?: AuthContext;
  orgAuth?: string;
  organizationId?: string;
  email: string;
}): Promise<GetLeadByEmailOutput> {
  const auth = extractAuth(opts);
  const { email } = opts;

  const resp = await backendAltFetch(
    auth,
    `/lead/get?email=${encodeURIComponent(email)}`,
    {
      method: 'GET',
    },
  );

  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }

  const data: ApiLeadItem[] = await resp.json();

  return {
    leads: (data || []).map(mapLead),
  };
}

// ============================================================================
// Tag Functions
// ============================================================================

interface ApiTagItem {
  id: string;
  label: string;
  color?: string;
  timestamp_created?: string;
}

/**
 * List all custom tags in the organization.
 */
export async function listTags(opts: {
  auth?: AuthContext;
  orgAuth?: string;
  organizationId?: string;
}): Promise<ListTagsOutput> {
  const auth = extractAuth(opts);

  const resp = await backendAltFetch(auth, '/custom-tag', {
    method: 'GET',
  });

  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }

  const raw = await resp.json();

  // Handle both paginated { data: [...] } and plain array responses
  const data: ApiTagItem[] = Array.isArray(raw) ? raw : raw.data || [];

  return {
    tags: data.map((t) => ({
      id: t.id,
      label: t.label,
      color: t.color,
      timestampCreated: t.timestamp_created,
    })),
  };
}

/**
 * Create a new custom tag.
 */
export async function createTag(opts: {
  auth?: AuthContext;
  orgAuth?: string;
  organizationId?: string;
  label: string;
}): Promise<CreateTagOutput> {
  const auth = extractAuth(opts);
  const { label } = opts;

  const resp = await backendAltFetch(auth, '/custom-tag', {
    method: 'POST',
    body: JSON.stringify({ label }),
  });

  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }

  const data: ApiTagItem = await resp.json();

  return {
    id: data.id,
    label: data.label,
  };
}

/**
 * Delete a custom tag.
 */
export async function deleteTag(opts: {
  auth?: AuthContext;
  orgAuth?: string;
  organizationId?: string;
  tagId: string;
}): Promise<DeleteTagOutput> {
  const auth = extractAuth(opts);
  const { tagId } = opts;

  // DELETE with no body must not send Content-Type: application/json (Fastify rejects empty JSON body)
  const resp = await fetch(`${BACKEND_ALT_BASE}/custom-tag/${tagId}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: {
      'X-Org-Auth': auth.orgAuth,
    },
  });

  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }

  return {
    success: true,
  };
}

// ============================================================================
// CRM Task Functions
// ============================================================================

interface ApiTaskItem {
  id: string;
  lead?: string;
  lead_id?: string;
  assignee?: string;
  description?: string;
  task_status: string;
  timestamp_due_date?: string;
  timestamp_created?: string;
  timestamp_updated?: string;
}

function mapTask(item: ApiTaskItem) {
  return {
    id: item.id,
    lead: item.lead,
    leadId: item.lead_id,
    assignee: item.assignee,
    description: item.description,
    taskStatus: item.task_status,
    timestampDueDate: item.timestamp_due_date,
    timestampCreated: item.timestamp_created,
    timestampUpdated: item.timestamp_updated,
  };
}

/**
 * List CRM tasks in the organization.
 */
export async function listTasks(opts: {
  auth?: AuthContext;
  orgAuth?: string;
  organizationId?: string;
  status?: 'Active' | 'Completed';
  limit?: number;
  skip?: number;
}): Promise<ListTasksOutput> {
  const auth = extractAuth(opts);
  const { status, limit = 50, skip = 0 } = opts;

  const params = new URLSearchParams({
    sort_column: 'timestamp_created',
    sort_order: 'desc',
    limit: String(limit),
    skip: String(skip),
  });
  if (status) {
    params.set('status', status);
  }

  const resp = await backendAltFetch(auth, `/tasks?${params.toString()}`, {
    method: 'GET',
  });

  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }

  const data: { data: ApiTaskItem[] } = await resp.json();

  return {
    tasks: (data.data || []).map(mapTask),
  };
}

/**
 * Create a new CRM task.
 */
export async function createTask(opts: {
  auth?: AuthContext;
  orgAuth?: string;
  organizationId?: string;
  description: string;
  leadId: string;
  title?: string;
  timestampDueDate?: string;
}): Promise<CreateTaskOutput> {
  const auth = extractAuth(opts);
  const { description, leadId, title, timestampDueDate } = opts;

  // timestamp_due_date is required by the API
  const dueDate =
    timestampDueDate ||
    new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const body: Record<string, unknown> = {
    description,
    lead_id: leadId,
    timestamp_due_date: dueDate,
  };
  if (title) body.title = title;

  const resp = await backendAltFetch(auth, '/tasks', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }

  const data: ApiTaskItem = await resp.json();
  return mapTask(data);
}

/**
 * Update a CRM task.
 */
export async function updateTask(opts: {
  auth?: AuthContext;
  orgAuth?: string;
  organizationId?: string;
  userId?: string;
  taskId: string;
  description?: string;
  taskStatus?: 'Active' | 'Completed';
  timestampDueDate?: string;
}): Promise<UpdateTaskOutput> {
  const auth = extractAuth(opts);
  const { taskId, description, taskStatus, timestampDueDate, userId } = opts;

  // Status changes use a dedicated endpoint; PATCH ignores task_status
  if (taskStatus === 'Completed') {
    const completeResp = await backendAltFetch(
      auth,
      `/tasks/${taskId}/complete`,
      {
        method: 'POST',
        body: JSON.stringify({}),
      },
    );
    if (!completeResp.ok) {
      throwForStatus(completeResp.status, await completeResp.text().catch(() => undefined));
    }
  }

  // If there are other fields to update besides status, PATCH them
  const hasOtherUpdates =
    description !== undefined || timestampDueDate !== undefined;
  if (hasOtherUpdates) {
    const body: Record<string, unknown> = {};
    if (userId) body.assignee = userId;
    if (description !== undefined) body.description = description;
    if (timestampDueDate !== undefined)
      body.timestamp_due_date = timestampDueDate;

    const patchResp = await backendAltFetch(auth, `/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });

    if (!patchResp.ok) {
      throwForStatus(patchResp.status, await patchResp.text().catch(() => undefined));
    }

    const data: ApiTaskItem = await patchResp.json();
    // PATCH response doesn't reflect the /complete status change, so override if we just completed it
    if (taskStatus === 'Completed') {
      data.task_status = 'Completed';
    }
    return mapTask(data);
  }

  // Status-only update: return confirmed state
  return {
    id: taskId,
    taskStatus: 'Completed',
  };
}

/**
 * Delete a CRM task.
 */
export async function deleteTask(opts: {
  auth?: AuthContext;
  orgAuth?: string;
  organizationId?: string;
  taskId: string;
}): Promise<DeleteTaskOutput> {
  const auth = extractAuth(opts);
  const { taskId } = opts;

  const resp = await fetch(`${BACKEND_ALT_BASE}/tasks/${taskId}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: {
      'X-Org-Auth': auth.orgAuth,
    },
  });

  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }

  const data: ApiTaskItem = await resp.json();
  return mapTask(data);
}

// ============================================================================
// Account Functions
// ============================================================================

interface ApiAccountItem {
  email: string;
  first_name?: string;
  last_name?: string;
  payload?: {
    name?: { first?: string; last?: string };
    signature?: string;
    provider?: string;
    warmup?: Record<string, unknown>;
  };
  status: number | string;
  warmup_status?: string;
  daily_limit?: number;
  timestamp_created?: string;
}

/**
 * List all email accounts in the organization.
 */
export async function listAccounts(opts: {
  auth?: AuthContext;
  orgAuth?: string;
  organizationId?: string;
  limit?: number;
  skip?: number;
}): Promise<ListAccountsOutput> {
  const auth = extractAuth(opts);
  const { limit = 100, skip = 0 } = opts;

  const body: Record<string, unknown> = {
    search: '',
    limit,
    skip,
    filter: null,
    countAccounts: false,
    include_tags: true,
  };

  const resp = await backendAltFetch(auth, '/account/list', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }

  const data: { accounts?: ApiAccountItem[] } | ApiAccountItem[] =
    await resp.json();

  // Handle both { accounts: [...] } and [...] response formats
  const accounts = Array.isArray(data)
    ? data
    : data.accounts
      ? data.accounts
      : [];

  return {
    accounts: accounts.map((a) => ({
      email: a.email,
      firstName:
        a.first_name !== undefined ? a.first_name : a.payload?.name?.first,
      lastName: a.last_name !== undefined ? a.last_name : a.payload?.name?.last,
      status:
        typeof a.status === 'string'
          ? a.status
          : a.status === 1
            ? 'active'
            : 'inactive',
      warmupStatus: a.warmup_status,
      signature: a.payload?.signature,
      provider: a.payload?.provider,
      dailyLimit: a.daily_limit,
      timestampCreated: a.timestamp_created,
    })),
  };
}

/**
 * Get detailed status for a specific email account.
 */
export async function getAccountStatus(opts: {
  auth?: AuthContext;
  orgAuth?: string;
  organizationId?: string;
  email: string;
}): Promise<GetAccountStatusOutput> {
  const auth = extractAuth(opts);
  const { email } = opts;

  const resp = await backendAltFetch(
    auth,
    `/account/status?email=${encodeURIComponent(email)}`,
    {
      method: 'GET',
    },
  );

  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }

  const data = await resp.json();

  return {
    email: data.account || email,
    status: data.status,
    warmupStatus: data.warmup_status,
    warmupEnabled: data.warmup_status === 'active',
  };
}

/**
 * Enable email warmup for an account.
 */
export async function enableWarmup(opts: {
  auth?: AuthContext;
  orgAuth?: string;
  organizationId?: string;
  email: string;
}): Promise<EnableWarmupOutput> {
  const auth = extractAuth(opts);
  const { email } = opts;

  const resp = await backendAltFetch(auth, '/account/warmup/enable', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });

  if (!resp.ok) {
    const errorData = await resp.json().catch(() => ({}));
    const errorMsg = errorData.error
      ? errorData.error
      : `Enable warmup failed: ${resp.status}`;
    return {
      success: false,
      email,
      error: errorMsg,
    };
  }

  return {
    success: true,
    email,
  };
}

/**
 * Pause email warmup for an account.
 */
export async function pauseWarmup(opts: {
  auth?: AuthContext;
  orgAuth?: string;
  organizationId?: string;
  email: string;
}): Promise<PauseWarmupOutput> {
  const auth = extractAuth(opts);
  const { email } = opts;

  const resp = await backendAltFetch(auth, '/account/warmup/pause', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });

  if (!resp.ok) {
    const errorData = await resp.json().catch(() => ({}));
    const errorMsg = errorData.error
      ? errorData.error
      : `Pause warmup failed: ${resp.status}`;
    return {
      success: false,
      email,
      error: errorMsg,
    };
  }

  return {
    success: true,
    email,
  };
}

/**
 * Test SMTP connection for an email account.
 */
export async function testSmtpConnection(opts: {
  auth?: AuthContext;
  orgAuth?: string;
  organizationId?: string;
  email: string;
  smtpHost: string;
  smtpPort: number;
  smtpUsername: string;
  smtpPassword: string;
}): Promise<TestSmtpConnectionOutput> {
  const auth = extractAuth(opts);
  const { email, smtpHost, smtpPort, smtpUsername, smtpPassword } = opts;

  const resp = await fetch(`${GAPI_BASE}/account/connect/test_smtp`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'X-Org-Auth': auth.orgAuth,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      smtp_host: smtpHost,
      smtp_port: smtpPort,
      smtp_username: smtpUsername,
      smtp_password: smtpPassword,
    }),
  });

  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }

  const data = await resp.json();

  if (data.status === 'success') {
    return { success: true };
  }

  return {
    success: false,
    error: data.error || 'SMTP connection failed',
  };
}

/**
 * Test IMAP connection for an email account.
 */
export async function testImapConnection(opts: {
  auth?: AuthContext;
  orgAuth?: string;
  organizationId?: string;
  email: string;
  imapHost: string;
  imapPort: number;
  imapUsername: string;
  imapPassword: string;
}): Promise<TestImapConnectionOutput> {
  const auth = extractAuth(opts);
  const { email, imapHost, imapPort, imapUsername, imapPassword } = opts;

  const resp = await fetch(`${GAPI_BASE}/account/connect/test_imap`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'X-Org-Auth': auth.orgAuth,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      imap_host: imapHost,
      imap_port: imapPort,
      imap_username: imapUsername,
      imap_password: imapPassword,
    }),
  });

  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }

  const data = await resp.json();

  if (data.status === 'success') {
    return { success: true };
  }

  return {
    success: false,
    error: data.error || 'IMAP connection failed',
    errorDetails: data.error_details,
  };
}

// ============================================================================
// Analytics Functions
// ============================================================================

/**
 * Get analytics for a specific campaign.
 */
export async function getCampaignAnalytics(opts: {
  auth?: AuthContext;
  orgAuth?: string;
  organizationId?: string;
  campaignId: string;
}): Promise<GetCampaignAnalyticsOutput> {
  const auth = extractAuth(opts);
  const { campaignId } = opts;

  const resp = await fetch(
    `${IAPI_ALT_BASE}/analytics/get_campaign_analytics`,
    {
      method: 'POST',
      credentials: 'include',
      headers: {
        'X-Org-Auth': auth.orgAuth,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ campaign_id: campaignId }),
    },
  );

  if (!resp.ok) {
    // API returns 500 for campaigns with no data - return zeros instead of throwing
    if (resp.status === 500) {
      return {
        campaignId,
        sent: 0,
        delivered: 0,
        opened: 0,
        clicked: 0,
        replied: 0,
        bounced: 0,
        unsubscribed: 0,
        openRate: 0,
        clickRate: 0,
        replyRate: 0,
      };
    }
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }

  const data = await resp.json();

  const sent = data.sent || 0;
  const delivered = data.delivered || sent;
  const opened = data.opened || 0;
  const clicked = data.clicked || 0;
  const replied = data.replied || 0;

  return {
    campaignId,
    sent,
    delivered,
    opened,
    clicked,
    replied,
    bounced: data.bounced || 0,
    unsubscribed: data.unsubscribed || 0,
    openRate: sent > 0 ? (opened / sent) * 100 : 0,
    clickRate: sent > 0 ? (clicked / sent) * 100 : 0,
    replyRate: sent > 0 ? (replied / sent) * 100 : 0,
  };
}

/**
 * Get organization-wide analytics summary.
 */
export async function getAnalyticsSummary(opts: {
  auth?: AuthContext;
  orgAuth?: string;
  organizationId?: string;
  startDate?: string;
  endDate?: string;
}): Promise<GetAnalyticsSummaryOutput> {
  const auth = extractAuth(opts);

  // Get revenue data
  const revenueResp = await backendAltFetch(
    auth,
    '/analytics/get-dollar-amount',
    {
      method: 'POST',
      body: JSON.stringify({}),
    },
  );

  let revenue: number | undefined;
  if (revenueResp.ok) {
    const revenueData = await revenueResp.json();
    revenue = revenueData.amount;
  }

  // Get org usage data
  const usageResp = await backendAltFetch(auth, '/organization/get_org_usage', {
    method: 'POST',
    body: JSON.stringify({}),
  });

  let contactsUsed: number | undefined;
  let contactsRemaining: number | undefined;
  if (usageResp.ok) {
    const usageData = await usageResp.json();
    contactsUsed = usageData.contacts_used;
    contactsRemaining = usageData.contacts_remaining;
  }

  // Get overall campaign stats by listing campaigns and summing
  const campaignsResp = await backendAltFetch(
    auth,
    '/campaign/list?limit=1000&skip=0',
    {
      method: 'GET',
    },
  );

  let totalSent = 0;
  let totalDelivered = 0;
  let totalOpened = 0;
  let totalClicked = 0;
  let totalReplied = 0;
  let totalBounced = 0;

  if (campaignsResp.ok) {
    const campaigns: { id: string }[] = await campaignsResp.json();

    // Aggregate analytics from all campaigns (limited to first 10 for performance)
    const campaignsToCheck = campaigns.slice(0, 10);
    for (const campaign of campaignsToCheck) {
      try {
        const analytics = await getCampaignAnalytics({
          auth,
          campaignId: campaign.id,
        });
        totalSent += analytics.sent;
        totalDelivered += analytics.delivered;
        totalOpened += analytics.opened;
        totalClicked += analytics.clicked;
        totalReplied += analytics.replied;
        totalBounced += analytics.bounced;
      } catch {
        // Skip campaigns that fail to fetch analytics
      }
    }
  }

  return {
    totalSent,
    totalDelivered,
    totalOpened,
    totalClicked,
    totalReplied,
    totalBounced,
    revenue,
    contactsUsed,
    contactsRemaining,
  };
}

/**
 * Get per-step sequence analytics for a campaign.
 */
export async function getStepAnalytics(opts: {
  auth?: AuthContext;
  orgAuth?: string;
  organizationId?: string;
  campaignId: string;
}): Promise<GetStepAnalyticsOutput> {
  const auth = extractAuth(opts);
  const { campaignId } = opts;

  // Fetch campaign to get sequence structure
  const campaign = await getCampaign({ auth, campaignId });

  // Fetch all leads for this campaign, paginating
  // Note: lead/list returns ALL org leads regardless of campaign_id filter,
  // so we fetch raw data and filter by campaign field client-side
  const allLeads: ListLeadsOutput['leads'] = [];
  let skip = 0;
  const pageSize = 100;
  while (true) {
    const resp = await backendAltFetch(auth, '/lead/list', {
      method: 'POST',
      body: JSON.stringify({ campaign_id: campaignId, limit: pageSize, skip }),
    });
    if (!resp.ok) break;
    const data: { items: (ApiLeadItem & { campaign?: string })[] } =
      await resp.json();
    const items = data.items || [];
    // Filter to only leads belonging to THIS campaign
    const campaignLeads = items.filter((item) => item.campaign === campaignId);
    allLeads.push(...campaignLeads.map(mapLead));
    if (items.length < pageSize) break;
    skip += pageSize;
  }

  // Aggregate lead-level metrics
  const totalLeads = allLeads.length;
  let totalOpened = 0;
  let totalReplied = 0;
  let totalClicked = 0;
  let activeLeads = 0;
  let completedLeads = 0;
  let bouncedLeads = 0;

  for (const lead of allLeads) {
    if (lead.emailOpenCount > 0) totalOpened++;
    if (lead.emailReplyCount > 0) totalReplied++;
    if (lead.emailClickCount > 0) totalClicked++;
    if (lead.status === 1) activeLeads++;
    if (lead.status === 3) completedLeads++;
    if (lead.status === -2) bouncedLeads++;
  }

  // Build step info from campaign sequence
  const steps = (campaign.sequences?.[0]?.steps || []).map((step, idx) => ({
    stepNumber: idx + 1,
    subject: step.variants?.[0]?.subject ?? '',
    variantCount: step.variants?.length ?? 1,
    variantSubjects: (step.variants ?? []).map((v) => v.subject),
    delay: step.delay ?? 0,
    delayUnit: step.delayUnit ?? 'days',
  }));

  return {
    campaignId,
    campaignName: campaign.name,
    totalLeads,
    activeLeads,
    completedLeads,
    bouncedLeads,
    leadsOpened: totalOpened,
    leadsReplied: totalReplied,
    leadsClicked: totalClicked,
    openRate:
      totalLeads > 0 ? Math.round((totalOpened / totalLeads) * 10000) / 100 : 0,
    replyRate:
      totalLeads > 0
        ? Math.round((totalReplied / totalLeads) * 10000) / 100
        : 0,
    clickRate:
      totalLeads > 0
        ? Math.round((totalClicked / totalLeads) * 10000) / 100
        : 0,
    steps,
  };
}

/**
 * Get CRM opportunity and revenue stats.
 */
export async function getCrmStats(opts: {
  auth?: AuthContext;
  orgAuth?: string;
  organizationId?: string;
  campaignId?: string;
  fromDate?: string;
  toDate?: string;
}): Promise<GetCrmStatsOutput> {
  const auth = extractAuth(opts);
  const { campaignId, fromDate, toDate } = opts;

  const now = new Date();
  const defaultFrom = new Date(
    now.getTime() - 30 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const defaultTo = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23,
    59,
    59,
    999,
  ).toISOString();

  const params = new URLSearchParams({
    include:
      'OPPORTUNITIES_WON,CASH_COLLECTED,TOTAL_OPPORTUNITIES,TOTAL_OPPORTUNITIES_VALUE',
    from: fromDate || defaultFrom,
    to: toDate || defaultTo,
  });
  // campaignId is required by the API; use empty string for org-wide stats
  params.set('campaignId', campaignId || '');

  const resp = await backendAltFetch(auth, `/crm/stats?${params.toString()}`, {
    method: 'GET',
  });

  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }

  const data = await resp.json();

  return {
    opportunitiesWon: data.opportunitiesWonCount || 0,
    cashCollected: data.cashCollected || 0,
    totalOpportunities: data.totalOpportunities || 0,
    totalOpportunitiesValue: data.totalOpportunitiesValue || 0,
  };
}

/**
 * Get current Instantly credits balance.
 */
export async function getCredits(opts: {
  auth?: AuthContext;
  orgAuth?: string;
  organizationId?: string;
}): Promise<GetCreditsOutput> {
  const auth = extractAuth(opts);

  // Get workspace ID (which is the same as organization ID in most cases)
  const resp = await fetch(
    `${BACKEND_V2_BASE}/workspaces/current/instantly-credits`,
    {
      method: 'GET',
      credentials: 'include',
      headers: {
        'x-workspace-id': auth.organizationId,
        'Content-Type': 'application/json',
      },
    },
  );

  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }

  const data = await resp.json();

  return {
    credits: data.credits || data.balance || 0,
    creditsUsed: data.credits_used,
    creditsTotal: data.credits_total,
  };
}

// ============================================================================
// Unibox Functions
// ============================================================================

interface ApiUniboxEmail {
  id: string;
  message_id?: string;
  subject?: string;
  snippet?: string;
  body_preview?: string;
  from_address_email: string;
  from_address_json?: Array<{ address: string; name?: string }>;
  to_address_email?: string;
  is_unread?: number;
  is_read?: boolean;
  timestamp: string;
  campaign_id?: string;
  lead_id?: string;
  lead?: {
    email?: string;
    first_name?: string;
    last_name?: string;
  };
  ai_interest_value?: number;
}

/**
 * Get count of unread emails in Unibox.
 */
export async function getUnreadCount(opts: {
  auth?: AuthContext;
  orgAuth?: string;
  organizationId?: string;
}): Promise<GetUnreadCountOutput> {
  const auth = extractAuth(opts);

  const resp = await backendAltFetch(auth, '/unibox/emails/count/unread', {
    method: 'GET',
  });

  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }

  const data = await resp.json();

  return {
    unreadCount: data.count !== undefined ? data.count : 0,
  };
}

/**
 * List emails from Unibox inbox.
 */
export async function listEmails(opts: {
  auth?: AuthContext;
  orgAuth?: string;
  organizationId?: string;
  filter?: 'all' | 'unread' | 'replied';
  search?: string;
  limit?: number;
  skip?: number;
}): Promise<ListEmailsOutput> {
  const auth = extractAuth(opts);
  const { filter = 'all', search, limit = 50, skip = 0 } = opts;

  const modeMap = {
    all: 'emode_all',
    unread: 'emode_unread',
    replied: 'emode_replied',
  } as const;
  const params = new URLSearchParams({
    mode: modeMap[filter],
    preview_only: 'true',
    limit: String(limit),
    skip: String(skip),
    latest_of_thread: 'true',
    sortOrder: 'desc',
  });

  if (search !== undefined) {
    params.set('search', search);
  }

  const resp = await backendAltFetch(
    auth,
    `/unibox/emails?${params.toString()}`,
    {
      method: 'GET',
    },
  );

  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }

  const rawData = await resp.json();
  const data: { page_trail?: string | null; data?: ApiUniboxEmail[] } = rawData;

  return {
    emails: (data.data !== undefined ? data.data : []).map((e) => ({
      id: e.id,
      messageId: e.message_id,
      subject: e.subject,
      snippet: e.snippet,
      bodyPreview: e.body_preview,
      from: e.from_address_email,
      fromAddressJson: e.from_address_json,
      to: e.to_address_email !== undefined ? e.to_address_email : '',
      isUnread: e.is_unread,
      isRead: e.is_read,
      timestamp: e.timestamp,
      campaignId: e.campaign_id,
      leadId: e.lead_id,
      lead: e.lead
        ? {
            email: e.lead.email,
            firstName: e.lead.first_name,
            lastName: e.lead.last_name,
          }
        : undefined,
      aiInterestValue: e.ai_interest_value,
    })),
  };
}

interface ApiEmailDetail {
  id: string;
  timestamp_created?: string;
  timestamp_email?: string;
  message_id?: string;
  subject?: string;
  from_address_email: string;
  to_address_email_list?: string[];
  cc_address_email_list?: string[];
  bcc_address_email_list?: string[];
  from_address_json?: Array<{ address: string; name?: string }>;
  to_address_json?: Array<{ address: string; name?: string }>;
  body?: {
    html: string;
    text?: string;
  };
  is_unread: number;
  campaign_id?: string;
  lead_id?: string;
  thread_id?: string;
  in_reply_to_msg_id?: string;
}

function mapEmailDetail(data: ApiEmailDetail): GetEmailDetailOutput {
  return {
    id: data.id,
    timestampCreated: data.timestamp_created,
    timestampEmail: data.timestamp_email,
    messageId: data.message_id,
    subject: data.subject,
    fromAddressEmail: data.from_address_email,
    toAddressEmailList: data.to_address_email_list,
    ccAddressEmailList: data.cc_address_email_list,
    bccAddressEmailList: data.bcc_address_email_list,
    fromAddressJson: data.from_address_json,
    toAddressJson: data.to_address_json,
    body: data.body,
    isUnread: data.is_unread,
    campaignId: data.campaign_id,
    leadId: data.lead_id,
    threadId: data.thread_id,
    inReplyToMsgId: data.in_reply_to_msg_id,
  };
}

/**
 * Get full email detail including body by ID.
 */
export async function getEmailDetail(opts: {
  auth?: AuthContext;
  orgAuth?: string;
  organizationId?: string;
  emailId: string;
}): Promise<GetEmailDetailOutput> {
  const auth = extractAuth(opts);
  const { emailId } = opts;

  const resp = await backendAltFetch(auth, `/unibox/emails/${emailId}`, {
    method: 'GET',
  });

  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }

  const data: ApiEmailDetail = await resp.json();
  return mapEmailDetail(data);
}

/**
 * Send a new email via Unibox (not part of a campaign).
 */
export async function sendEmail(opts: {
  auth?: AuthContext;
  orgAuth?: string;
  organizationId?: string;
  subject: string;
  from: string;
  to: string;
  body: string;
  cc?: string;
  bcc?: string;
}): Promise<SendEmailOutput> {
  const auth = extractAuth(opts);
  const { subject, from, to, body, cc, bcc } = opts;

  const requestBody: Record<string, unknown> = {
    subject,
    from,
    to,
    body,
  };

  if (cc !== undefined) {
    requestBody.cc = cc;
  }
  if (bcc !== undefined) {
    requestBody.bcc = bcc;
  }

  const resp = await backendAltFetch(auth, '/unibox/emails/send', {
    method: 'POST',
    body: JSON.stringify(requestBody),
  });

  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }

  const data: ApiEmailDetail = await resp.json();
  return mapEmailDetail(data);
}

/**
 * Reply to an existing email thread.
 */
export async function replyToEmail(opts: {
  auth?: AuthContext;
  orgAuth?: string;
  organizationId?: string;
  subject: string;
  from: string;
  to: string;
  body: string;
  replyToUuid: string;
  cc?: string;
  bcc?: string;
}): Promise<ReplyToEmailOutput> {
  const auth = extractAuth(opts);
  const { subject, from, to, body, replyToUuid, cc, bcc } = opts;

  const requestBody: Record<string, unknown> = {
    subject,
    from,
    to,
    body,
    reply_to_uuid: replyToUuid,
  };

  if (cc !== undefined) {
    requestBody.cc = cc;
  }
  if (bcc !== undefined) {
    requestBody.bcc = bcc;
  }

  const resp = await backendAltFetch(auth, '/unibox/emails/reply', {
    method: 'POST',
    body: JSON.stringify(requestBody),
  });

  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }

  const data: ApiEmailDetail = await resp.json();
  return mapEmailDetail(data);
}

/**
 * Mark an email as read or unread.
 */
export async function markEmailRead(opts: {
  auth?: AuthContext;
  orgAuth?: string;
  organizationId?: string;
  emailId: string;
  isUnread: number;
}): Promise<MarkEmailReadOutput> {
  const auth = extractAuth(opts);
  const { emailId, isUnread } = opts;

  const resp = await backendAltFetch(auth, `/unibox/emails/${emailId}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_unread: isUnread }),
  });

  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }

  const data: ApiEmailDetail = await resp.json();
  return mapEmailDetail(data);
}

// ============================================================================
// Lead Management Functions
// ============================================================================

/**
 * Move leads between campaigns.
 */
export async function moveLeads(opts: {
  auth?: AuthContext;
  orgAuth?: string;
  organizationId?: string;
  fromCampaignId: string;
  toCampaignId: string;
  emails: string[];
}): Promise<MoveLeadsOutput> {
  const auth = extractAuth(opts);
  const { fromCampaignId, toCampaignId, emails } = opts;

  if (!emails || emails.length === 0) {
    throw new Validation('At least one email is required');
  }

  const resp = await backendAltFetch(auth, '/lead/move', {
    method: 'POST',
    body: JSON.stringify({
      from_campaign_id: fromCampaignId,
      to_campaign_id: toCampaignId,
      emails: emails,
    }),
  });

  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }

  const data = await resp.json();

  return {
    success: data.success !== undefined ? data.success : false,
    totalLeadsToMove:
      data.totalLeadsToMove !== undefined ? data.totalLeadsToMove : 0,
    existingLeadsCount:
      data.existingLeadsCount !== undefined ? data.existingLeadsCount : 0,
    totalLeadsMoved:
      data.totalLeadsMoved !== undefined ? data.totalLeadsMoved : 0,
    ignoredLeadsCount:
      data.ignoredLeadsCount !== undefined ? data.ignoredLeadsCount : 0,
  };
}

/**
 * List lead labels in the organization.
 */
export async function listLeadLabels(opts: {
  auth?: AuthContext;
  orgAuth?: string;
  organizationId?: string;
  limit?: number;
}): Promise<ListLeadLabelsOutput> {
  const auth = extractAuth(opts);
  const { limit = 100 } = opts;

  const resp = await backendAltFetch(auth, `/lead-labels?limit=${limit}`, {
    method: 'GET',
  });

  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }

  const data: Array<{
    id: string;
    name: string;
    color?: string;
    timestamp_created?: string;
  }> = await resp.json();

  return {
    labels: data.map((label) => ({
      id: label.id,
      name: label.name,
      color: label.color,
      timestampCreated: label.timestamp_created,
    })),
  };
}

/**
 * List contact/lead lists.
 */
export async function listLists(opts: {
  auth?: AuthContext;
  orgAuth?: string;
  organizationId?: string;
  search?: string;
  limit?: number;
  skip?: number;
}): Promise<ListListsOutput> {
  const auth = extractAuth(opts);
  const { search, limit = 20, skip = 0 } = opts;

  const params = new URLSearchParams({
    limit: String(limit),
    skip: String(skip),
  });

  if (search !== undefined) {
    params.set('search', search);
  } else {
    params.set('search', '');
  }

  const resp = await backendAltFetch(auth, `/lists?${params.toString()}`, {
    method: 'GET',
  });

  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }

  const data: Array<{
    id: string;
    name: string;
    count?: number;
    timestamp_created?: string;
  }> = await resp.json();

  return {
    lists: data.map((list) => ({
      id: list.id,
      name: list.name,
      count: list.count,
      timestampCreated: list.timestamp_created,
    })),
  };
}

/**
 * Update email account settings (name, signature/footer, daily limit).
 */
export async function updateAccount(opts: {
  auth?: AuthContext;
  orgAuth?: string;
  organizationId?: string;
  email: string;
  firstName?: string;
  lastName?: string;
  signature?: string;
  emailFooter?: string;
  dailyLimit?: number;
}): Promise<UpdateAccountOutput> {
  const auth = extractAuth(opts);
  const { email, firstName, lastName, signature, emailFooter, dailyLimit } =
    opts;

  // Account updates go through the v2 PATCH endpoint (v1 silently ignores payload changes)
  const requestBody: Record<string, unknown> = {};

  if (firstName !== undefined) {
    requestBody.first_name = firstName;
  }
  if (lastName !== undefined) {
    requestBody.last_name = lastName;
  }
  if (signature !== undefined) {
    requestBody.signature = signature;
  }
  if (emailFooter !== undefined) {
    requestBody.email_footer = emailFooter;
  }
  if (dailyLimit !== undefined) {
    requestBody.daily_limit = dailyLimit;
  }

  const resp = await backendV2Fetch(
    auth,
    `/accounts/${encodeURIComponent(email)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(requestBody),
    },
  );

  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }

  // v2 returns the full account object on success
  await resp.json();

  return {
    status: 'success',
  };
}

// ============================================================================
// Workspace / Organization Functions
// ============================================================================

/**
 * List all members of the current workspace.
 */
export async function listWorkspaceMembers(opts: {
  auth?: AuthContext;
  orgAuth?: string;
  organizationId?: string;
  limit?: number;
}): Promise<ListWorkspaceMembersOutput> {
  const auth = extractAuth(opts);
  const { limit = 100 } = opts;

  const resp = await backendV2Fetch(auth, `/workspace-members?limit=${limit}`, {
    method: 'GET',
  });

  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }

  const data: {
    items: Array<{
      id: string;
      email: string;
      role: string;
      name?: { first?: string; last?: string };
      accepted: boolean;
    }>;
  } = await resp.json();

  return {
    members: (data.items || []).map((m) => ({
      id: m.id,
      email: m.email,
      role: m.role,
      firstName: m.name?.first,
      lastName: m.name?.last,
      accepted: m.accepted,
    })),
  };
}

/**
 * Get organization plan details, trial info, and feature flags.
 */
export async function getOrganizationData(opts: {
  auth?: AuthContext;
  orgAuth?: string;
  organizationId?: string;
}): Promise<GetOrganizationDataOutput> {
  const auth = extractAuth(opts);

  const resp = await backendAltFetch(auth, '/organization/get_org_data', {
    method: 'POST',
    body: JSON.stringify({}),
  });

  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }

  const data = await resp.json();

  return {
    data,
  };
}
