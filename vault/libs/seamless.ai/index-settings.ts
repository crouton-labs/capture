/**
 * Seamless.AI Settings & Organization Functions
 *
 * Org-scoped settings, credits, industries, and engagement configuration.
 */

import type {
  ListOrgUsersInput,
  ListOrgUsersOutput,
  GetCreditsInput,
  GetCreditsOutput,
  ListIndustriesInput,
  ListIndustriesOutput,
  GetDashboardROIInput,
  GetDashboardROIOutput,
  ListConnectedEmailsInput,
  ListConnectedEmailsOutput,
  GetEmailSignatureInput,
  GetEmailSignatureOutput,
  ListContactStatusesInput,
  ListContactStatusesOutput,
  ListCallDispositionsInput,
  ListCallDispositionsOutput,
} from './schemas-settings';

export type {
  ListOrgUsersInput,
  ListOrgUsersOutput,
  GetCreditsInput,
  GetCreditsOutput,
  ListIndustriesInput,
  ListIndustriesOutput,
  GetDashboardROIInput,
  GetDashboardROIOutput,
  ListConnectedEmailsInput,
  ListConnectedEmailsOutput,
  GetEmailSignatureInput,
  GetEmailSignatureOutput,
  ListContactStatusesInput,
  ListContactStatusesOutput,
  ListCallDispositionsInput,
  ListCallDispositionsOutput,
  OrgUser,
  CreditPoolDetail,
  Industry,
  ROIMetrics,
  ConnectedEmail,
  EmailSignature,
  ContactStatus,
  CallDisposition,
} from './schemas-settings';

import { seamlessGet } from './helpers';

// ============================================================================
// listOrgUsers
// ============================================================================

export async function listOrgUsers(
  params: ListOrgUsersInput,
): Promise<ListOrgUsersOutput> {
  const data = (await seamlessGet(
    `/users/orgs/${params.orgId}/orgUsers`,
  )) as Record<string, unknown>;

  const items = (data.items ?? []) as Array<Record<string, unknown>>;

  const users = items.map((u) => ({
    id: String(u.id ?? ''),
    firstName: String(u.firstName ?? ''),
    lastName: String(u.lastName ?? ''),
    username: String(u.username ?? ''),
    role: String(u.role ?? ''),
    orgUserId: String(u.orgUserId ?? ''),
    deactivatedAt: (u.deactivatedAt as string | null) ?? null,
    deactivationReason: (u.deactivationReason as string | null) ?? null,
  }));

  return { users };
}

// ============================================================================
// getCredits
// ============================================================================

export async function getCredits(
  _params: GetCreditsInput,
): Promise<GetCreditsOutput> {
  const resp = (await seamlessGet('/users/credits')) as Record<string, unknown>;
  const data = (resp.data ?? resp) as Record<string, Record<string, unknown>>;

  const pools: Record<
    string,
    {
      key: number;
      label: string;
      credits: number;
      creditsRemaining: number;
      searchCredits: number;
      searchCreditsRemaining: number;
      companySaveCredits: number;
      companySaveCreditsRemaining: number;
      licenseType: string | null;
      licenseStatus: string | null;
      bonusCredits: number;
      licenseCreditPeriodEndsAt: string | null;
    }
  > = {};

  for (const [poolName, pool] of Object.entries(data)) {
    if (typeof pool !== 'object' || pool === null) continue;
    pools[poolName] = {
      key: (pool.key as number) ?? 0,
      label: (pool.label as string) ?? '',
      credits: (pool.credits as number) ?? 0,
      creditsRemaining: (pool.creditsRemaining as number) ?? 0,
      searchCredits: (pool.searchCredits as number) ?? 0,
      searchCreditsRemaining: (pool.searchCreditsRemaining as number) ?? 0,
      companySaveCredits: (pool.companySaveCredits as number) ?? 0,
      companySaveCreditsRemaining:
        (pool.companySaveCreditsRemaining as number) ?? 0,
      licenseType: (pool.licenseType as string | null) ?? null,
      licenseStatus: (pool.licenseStatus as string | null) ?? null,
      bonusCredits: (pool.bonusCredits as number) ?? 0,
      licenseCreditPeriodEndsAt:
        (pool.licenseCreditPeriodEndsAt as string | null) ?? null,
    };
  }

  return { pools };
}

// ============================================================================
// listIndustries
// ============================================================================

export async function listIndustries(
  _params: ListIndustriesInput,
): Promise<ListIndustriesOutput> {
  const resp = (await seamlessGet('/lookup/industries')) as Record<
    string,
    unknown
  >;
  const data = (resp.data ?? []) as Array<Record<string, unknown>>;

  const industries = data.map((cat) => ({
    label: String(cat.label ?? ''),
    value: String(cat.value ?? ''),
    apiValue: String(cat.apiValue ?? ''),
    children: ((cat.children ?? []) as Array<Record<string, unknown>>).map(
      (child) => ({
        label: String(child.label ?? ''),
        value: String(child.value ?? ''),
        apiValue: String(child.apiValue ?? ''),
      }),
    ),
  }));

  return { industries };
}

// ============================================================================
// getDashboardROI
// ============================================================================

export async function getDashboardROI(
  params: GetDashboardROIInput,
): Promise<GetDashboardROIOutput> {
  const resp = (await seamlessGet(
    `/users/orgs/${params.orgId}/roiCalculations`,
  )) as Record<string, unknown>;
  const data = (resp.data ?? resp) as Record<string, unknown>;

  return {
    metrics: {
      opportunitiesCreated: (data.opportunitiesCreated as number) ?? 0,
      pipelineGenerated: (data.pipelineGenerated as number) ?? 0,
      sales: (data.sales as number) ?? 0,
      revenue: (data.revenue as number) ?? 0,
      returnOnInvestment: (data.returnOnInvestment as number) ?? 0,
      averageDealSize: (data.averageDealSize as number) ?? 0,
      costPerLead: (data.costPerLead as number) ?? 0,
      costPerOpportunity: (data.costPerOpportunity as number) ?? 0,
      costPerSale: (data.costPerSale as number) ?? 0,
      researchedLeads: (data.researchedLeads as number) ?? 0,
      searchedLeads: (data.searchedLeads as number) ?? 0,
      minutesSaved: (data.minutesSaved as number) ?? 0,
      hoursSaved: (data.hoursSaved as number) ?? 0,
      daysSaved: (data.daysSaved as number) ?? 0,
    },
    dashboardType: String(data.dashboardType ?? 'statistic'),
    enabledCrms: (data.enabledCrms as string[]) ?? [],
  };
}

// ============================================================================
// listConnectedEmails
// ============================================================================

export async function listConnectedEmails(
  params: ListConnectedEmailsInput,
): Promise<ListConnectedEmailsOutput> {
  const resp = (await seamlessGet(
    `/users/orgs/${params.orgId}/engagements/emails/connectedEmails`,
  )) as Record<string, unknown>;
  const data = resp.data as
    | Record<string, unknown>
    | Array<Record<string, unknown>>
    | undefined;

  // Response can be an object with email keys, an array, or empty {}
  const emails: Array<{
    email: string;
    provider?: string;
    isActive?: boolean;
  }> = [];

  if (Array.isArray(data)) {
    for (const item of data) {
      emails.push({
        email: String(item.email ?? item.emailAddress ?? ''),
        provider: item.provider ? String(item.provider) : undefined,
        isActive: item.isActive != null ? Boolean(item.isActive) : undefined,
      });
    }
  } else if (data && typeof data === 'object' && Object.keys(data).length > 0) {
    // Could be keyed by email address or userId
    for (const [key, val] of Object.entries(data)) {
      if (typeof val === 'object' && val !== null) {
        const entry = val as Record<string, unknown>;
        emails.push({
          email: String(entry.email ?? entry.emailAddress ?? key),
          provider: entry.provider ? String(entry.provider) : undefined,
          isActive:
            entry.isActive != null ? Boolean(entry.isActive) : undefined,
        });
      }
    }
  }

  return { emails };
}

// ============================================================================
// getEmailSignature
// ============================================================================

export async function getEmailSignature(
  params: GetEmailSignatureInput,
): Promise<GetEmailSignatureOutput> {
  const resp = (await seamlessGet(
    `/users/orgs/${params.orgId}/engagements/emails/signature?isDefault=true`,
  )) as Record<string, unknown>;
  const data = (resp.data ?? resp) as Record<string, unknown>;

  return {
    emailSignatureId: String(data.emailSignatureId ?? ''),
    signature: String(data.signature ?? ''),
    isDefault: (data.isDefault as boolean) ?? false,
  };
}

// ============================================================================
// listContactStatuses
// ============================================================================

export async function listContactStatuses(
  params: ListContactStatusesInput,
): Promise<ListContactStatusesOutput> {
  const resp = (await seamlessGet(
    `/users/orgs/${params.orgId}/engagements/prospectStatuses`,
  )) as Record<string, unknown>;
  const data = (resp.data ?? []) as Array<Record<string, unknown>>;

  const statuses = data.map((s) => ({
    id: String(s.id ?? s._id ?? ''),
    name: String(s.name ?? ''),
    color: s.color ? String(s.color) : undefined,
    order: s.order != null ? Number(s.order) : undefined,
  }));

  return { statuses };
}

// ============================================================================
// listCallDispositions
// ============================================================================

export async function listCallDispositions(
  params: ListCallDispositionsInput,
): Promise<ListCallDispositionsOutput> {
  const resp = (await seamlessGet(
    `/users/orgs/${params.orgId}/engagements/callDispositions`,
  )) as Record<string, unknown>;

  // Response uses "items" key (not "data")
  const items = (resp.items ?? resp.data ?? []) as Array<
    Record<string, unknown>
  >;

  const dispositions = items.map((d) => ({
    id: String(d.id ?? d._id ?? ''),
    name: String(d.name ?? ''),
    order: d.order != null ? Number(d.order) : undefined,
  }));

  return { dispositions };
}
