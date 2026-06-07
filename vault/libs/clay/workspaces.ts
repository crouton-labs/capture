/**
 * Workspace operations
 */

import { ContractDrift, Validation, NotFound, PermissionDenied } from '@vallum/_runtime';
import { clayFetch } from './shared';
import type { ClayWorkspace } from './schemas';
import type {
  GetWorkspacesOutput,
  GetWorkspaceDetailsOutput,
  GetSubscriptionOutput,
  GetCreditReportOutput,
  ListWorkspaceMembersOutput,
  InviteWorkspaceMemberOutput,
  RemoveWorkspaceMemberOutput,
  UpdateWorkspaceMemberRoleOutput,
  ListAppAccountsOutput,
  SetDefaultAppAccountOutput,
  UpdateWorkspaceInput,
  UpdateWorkspaceOutput,
  GetResourceInput,
  GetResourceOutput,
  LogResourceActivityInput,
  LogResourceActivityOutput,
  RemoveWorkspaceUserInput,
  RemoveWorkspaceUserOutput,
  GetKnockTokenOutput,
  GetCreditAccrualInput,
  GetCreditAccrualOutput,
} from './schemas';

interface WorkspacesResponse {
  results: ClayWorkspace[];
}

interface GetResourceResponse {
  id: string;
  resourceType: 'WORKBOOK' | 'TABLE' | 'FOLDER';
  name: string;
  description: string | null;
  workspaceId: number;
  parentFolderId: string | null;
  settings?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  defaultAccess?: string;
  ownerId?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  isHidden?: boolean;
  isHiddenFromNavigation?: boolean;
  creditLimit?: number | null;
  abilities: {
    canDelete: boolean;
    canUpdate: boolean;
    canManageAccess?: boolean;
    canUpdateFromSandbox?: boolean;
  };
  isStarred: boolean;
  lastOpenedAt?: string | null;
  owner?: {
    id: number;
    username: string;
    email: string;
    name: string;
    profilePicture: string | null;
    fullName: string;
  };
  parentResourcePath: Array<{ id: string; name: string; type: string }>;
  tags: string[];
}

/**
 * List all workspaces available to the current user.
 */
export async function getWorkspaces(): Promise<GetWorkspacesOutput> {
  const data = await clayFetch<WorkspacesResponse>('/my-workspaces');

  return {
    workspaces: data.results,
    totalCount: data.results.length,
  };
}

interface WorkspaceDetailsResponse {
  id: number;
  name: string;
  createdByUserId: string;
  icon: { url: string } | null;
  billingPlanType: string;
  billingEmail?: string;
  customerId: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  billingPlanUpdatedAt: string;
  settings: Record<string, string | number | boolean>;
  featureFlags: Record<string, boolean | number | string | string[]>;
  credits: {
    basic: number;
    longExpiry?: number;
    actionExecution?: number;
  };
  creditBudgets: {
    basic: number;
    longExpiry?: number;
    actionExecution?: number;
  };
  currentPeriodEnd: number;
  centsPerCredit: number;
  onboardingData: Record<string, unknown>;
  abilities: Record<string, boolean>;
  audienceAbilities: Record<string, boolean>;
}

/**
 * Get details for a specific workspace.
 */
export async function getWorkspaceDetails(opts: {
  workspaceId: string;
}): Promise<GetWorkspaceDetailsOutput> {
  if (
    opts.workspaceId == null ||
    typeof opts.workspaceId === 'boolean' ||
    String(opts.workspaceId).trim() === ''
  ) {
    throw new Validation(
      'getWorkspaceDetails: workspaceId is required (numeric string, e.g. "980747")',
    );
  }

  const workspaceId = String(opts.workspaceId).trim();

  const data = await clayFetch<WorkspaceDetailsResponse>(
    `/workspaces/${workspaceId}`,
  );

  return {
    id: data.id,
    name: data.name,
    createdByUserId: data.createdByUserId,
    icon: data.icon,
    billingPlanType: data.billingPlanType,
    billingEmail: data.billingEmail,
    customerId: data.customerId,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    deletedAt: data.deletedAt,
    billingPlanUpdatedAt: data.billingPlanUpdatedAt,
    settings: data.settings,
    featureFlags: data.featureFlags,
    credits: {
      basic: data.credits.basic,
      longExpiry: data.credits.longExpiry,
      actionExecution: data.credits.actionExecution,
    },
    creditBudgets: {
      basic: data.creditBudgets.basic,
      longExpiry: data.creditBudgets.longExpiry,
      actionExecution: data.creditBudgets.actionExecution,
    },
    currentPeriodEnd: data.currentPeriodEnd,
    centsPerCredit: data.centsPerCredit,
    onboardingData: data.onboardingData,
    abilities: data.abilities,
    audienceAbilities: data.audienceAbilities,
  };
}

interface SubscriptionResponse {
  workspaceId: number;
  creditBalances: {
    basic: number;
    longExpiry?: number;
    actionExecution?: number;
  };
  creditBudgets: {
    basic: number;
    longExpiry?: number;
    actionExecution?: number;
  };
  currentPeriodStart: number;
  currentPeriodEnd: number;
  stripeSubscriptionStatus: string;
  limits: Record<string, { limit?: number; current?: number } | boolean>;
  schedule: Array<{
    start: number;
    end: number;
    priceId: string;
    priceIdType: string;
    productId: string;
    productName: string;
    isCurrentPhase: boolean;
    unitAmount: number;
  }>;
  scheduledChangeType: string | null;
  pastDueInvoice: unknown;
  paymentMethod: unknown;
  cancelAtPeriodEnd: boolean;
  collectionMethod: string;
  metadata: Record<string, string>;
}

/**
 * Get subscription and credit balance for a workspace.
 * Check this before running any credit-costing operations.
 */
export async function getSubscription(opts: {
  workspaceId: string;
}): Promise<GetSubscriptionOutput> {
  const { workspaceId } = opts;

  if (!workspaceId) {
    throw new Validation('workspaceId is required');
  }

  const data = await clayFetch<SubscriptionResponse>(
    `/subscriptions/${workspaceId}`,
  );

  return {
    workspaceId: data.workspaceId,
    creditBalances: {
      basic: data.creditBalances.basic,
      longExpiry: data.creditBalances.longExpiry,
      actionExecution: data.creditBalances.actionExecution,
    },
    creditBudgets: {
      basic: data.creditBudgets.basic,
      longExpiry: data.creditBudgets.longExpiry,
      actionExecution: data.creditBudgets.actionExecution,
    },
    currentPeriodStart: data.currentPeriodStart,
    currentPeriodEnd: data.currentPeriodEnd,
    stripeSubscriptionStatus: data.stripeSubscriptionStatus,
    limits: data.limits,
    schedule: data.schedule,
    scheduledChangeType: data.scheduledChangeType,
    pastDueInvoice: data.pastDueInvoice,
    paymentMethod: data.paymentMethod,
    cancelAtPeriodEnd: data.cancelAtPeriodEnd,
    collectionMethod: data.collectionMethod,
    metadata: data.metadata,
  };
}

/**
 * Get credit usage report for a workspace.
 */
export async function getCreditReport(opts: {
  workspaceId: string;
  reportType: 'workspace' | 'integration' | 'signal';
  startTime: string;
  endTime: string;
}): Promise<GetCreditReportOutput> {
  const { workspaceId, reportType, startTime, endTime } = opts;

  if (!workspaceId) {
    throw new Validation('getCreditReport: workspaceId is required');
  }
  if (!reportType) {
    throw new Validation('getCreditReport: reportType is required');
  }
  if (!startTime || !endTime) {
    throw new Validation('getCreditReport: startTime and endTime are required');
  }

  const params = new URLSearchParams();
  params.set('timeRange[startTime]', startTime);
  params.set('timeRange[endTime]', endTime);

  const path = `/credit-reporting/${workspaceId}/creditReportType/${reportType}?${params.toString()}`;

  const data = await clayFetch<GetCreditReportOutput>(path);

  return {
    entities: (data.entities || []).map((e) => ({
      id: e.id,
      entity: e.entity,
      credits: e.credits,
      ...(e.subentities !== undefined && { subentities: e.subentities }),
      ...(e.actionExecutions !== undefined && {
        actionExecutions: e.actionExecutions,
      }),
      ...(e.hasRecurringUsage !== undefined && {
        hasRecurringUsage: e.hasRecurringUsage,
      }),
      ...(e.creditLimitInfo !== undefined && {
        creditLimitInfo: e.creditLimitInfo,
      }),
    })),
    unattributedCredits: data.unattributedCredits,
  };
}

/**
 * List workspace members.
 */
export async function listWorkspaceMembers(opts: {
  workspaceId: string;
}): Promise<ListWorkspaceMembersOutput> {
  const { workspaceId } = opts;

  if (!workspaceId) {
    throw new Validation('workspaceId is required');
  }

  const data = await clayFetch<{
    users: Array<{
      id: number;
      username: string;
      email: string;
      name: string;
      fullName: string;
      profilePicture?: string;
      role: {
        id: string;
        role: string;
      };
    }>;
  }>(`/workspaces/${workspaceId}/users`);

  const users = (data.users || []).map((u) => ({
    id: u.id,
    username: u.username,
    email: u.email,
    name: u.name,
    fullName: u.fullName,
    profilePicture: u.profilePicture,
    role: {
      id: u.role.id,
      role: u.role.role,
    },
  }));

  return {
    users,
    totalCount: users.length,
  };
}

/**
 * Invite a new member to the workspace.
 */
export async function inviteWorkspaceMember(opts: {
  workspaceId: string;
  email: string;
  role?: string;
}): Promise<InviteWorkspaceMemberOutput> {
  const { workspaceId, email, role = 'workspace-member' } = opts;

  if (!workspaceId) {
    throw new Validation('inviteWorkspaceMember: workspaceId is required');
  }
  if (!email) {
    throw new Validation('inviteWorkspaceMember: email is required');
  }

  const data = await clayFetch<{
    invitations: Array<{
      roleId: string;
      email: string;
      pending: boolean;
      user: {
        id: number;
        username: string;
        email: string;
        name: string;
        fullName: string;
        profilePicture?: string;
      } | null;
      role: {
        id: string;
        role: string;
      };
    }>;
  }>(`/workspaces/${workspaceId}/invite`, {
    method: 'POST',
    body: JSON.stringify({ emails: [email], role }),
  });

  const invitation = data.invitations?.[0];
  if (!invitation) {
    throw new ContractDrift(
      'inviteWorkspaceMember: no invitation returned in response',
    );
  }

  return {
    roleId: invitation.roleId,
    email: invitation.email,
    pending: invitation.pending,
    user: invitation.user,
    role: invitation.role,
  };
}

/**
 * Remove a member from the workspace.
 * Validates that the roleId belongs to the specified workspace before deleting.
 */
export async function removeWorkspaceMember(opts: {
  workspaceId: string;
  roleId: string;
}): Promise<RemoveWorkspaceMemberOutput> {
  const { workspaceId, roleId } = opts;

  if (!workspaceId) {
    throw new Validation('removeWorkspaceMember: workspaceId is required');
  }
  if (!roleId) {
    throw new Validation('removeWorkspaceMember: roleId is required');
  }

  // Validate UUID format to avoid 500 errors from the API
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(String(roleId))) {
    throw new Validation(
      'removeWorkspaceMember: roleId must be a valid UUID (get it from listWorkspaceMembers role.id field)',
    );
  }

  // Validate roleId belongs to this workspace before deleting
  // Use /permissions endpoint which includes both active members AND pending invitations
  const permissions = await clayFetch<{
    userPermissions: Array<{
      roleId: string;
      pending: boolean;
      role: {
        id: string;
        role: string;
      };
    }>;
  }>(`/workspaces/${workspaceId}/permissions`);

  const match = (permissions.userPermissions || []).find(
    (p) => p.roleId === roleId,
  );
  if (!match) {
    throw new NotFound(
      `removeWorkspaceMember: roleId ${roleId} not found in workspace ${workspaceId}. Use listWorkspaceMembers to get valid role IDs.`,
    );
  }

  // Prevent removing the workspace owner; this is destructive and irreversible.
  // Only block non-pending workspace-admins (the actual owner).
  // Pending admin invitations can be safely revoked.
  if (match.role?.role === 'workspace-admin' && !match.pending) {
    throw new PermissionDenied(
      `removeWorkspaceMember: cannot remove the workspace owner (role: workspace-admin). This would lock the owner out of the workspace permanently.`,
    );
  }

  await clayFetch(`/permissions/${roleId}`, {
    method: 'DELETE',
    body: JSON.stringify({ permissionId: roleId }),
  });

  return {
    success: true,
  };
}

interface UpdatePermissionsResponse {
  userPermissions: Array<{
    roleId: string;
    email: string;
    pending: boolean;
    user?: {
      id: number;
      username: string;
      email: string;
      name: string;
      fullName: string;
      profilePicture?: string;
    };
    role: {
      id: string;
      role: string;
    };
  }>;
}

/**
 * Update a workspace member's role.
 */
export async function updateWorkspaceMemberRole(opts: {
  workspaceId: string;
  userRoleId: string;
  role: string;
}): Promise<UpdateWorkspaceMemberRoleOutput> {
  const { workspaceId, userRoleId, role } = opts;

  if (!workspaceId) {
    throw new Validation('updateWorkspaceMemberRole: workspaceId is required');
  }
  if (!userRoleId) {
    throw new Validation('updateWorkspaceMemberRole: userRoleId is required');
  }
  if (!role) {
    throw new Validation('updateWorkspaceMemberRole: role is required');
  }

  const validRoles = [
    'workspace-admin',
    'workspace-member',
    'workspace-viewer',
    'workspace-sales-rep',
  ];
  if (!validRoles.includes(role)) {
    throw new Validation(
      `updateWorkspaceMemberRole: invalid role "${role}". Valid roles: ${validRoles.join(', ')}`,
    );
  }

  const data = await clayFetch<UpdatePermissionsResponse>(
    `/workspaces/${workspaceId}/update-permissions`,
    {
      method: 'PATCH',
      body: JSON.stringify({ userRoleIds: [userRoleId], role }),
    },
  );

  const updated = data.userPermissions?.find((p) => p.roleId === userRoleId);
  if (!updated) {
    throw new NotFound(
      `updateWorkspaceMemberRole: userRoleId ${userRoleId} not found in workspace ${workspaceId}. Use listWorkspaceMembers to get valid role IDs.`,
    );
  }

  return {
    success: true,
    userRoleId: updated.roleId,
    role: updated.role.role,
    email: updated.email,
  };
}

interface AppAccountData {
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
 * List connected app accounts in a workspace.
 */
export async function listAppAccounts(opts: {
  workspaceId: string;
}): Promise<ListAppAccountsOutput> {
  const { workspaceId } = opts;

  if (!workspaceId) {
    throw new Validation('workspaceId is required');
  }

  // API returns a direct array, not wrapped in { accounts: [...] }
  const data = await clayFetch<AppAccountData[]>(
    `/workspaces/${workspaceId}/app-accounts`,
  );

  const appAccounts = (data || []).map((a) => ({
    id: a.id,
    name: a.name,
    appAccountTypeId: a.appAccountTypeId,
    isSharedPublicKey: a.isSharedPublicKey,
    userOwnerId: a.userOwnerId,
    workspaceOwnerId: a.workspaceOwnerId,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    deletedAt: a.deletedAt,
    useStaticIP: a.useStaticIP,
    reauthInitiatedAt: a.reauthInitiatedAt,
    reauthInitiatedByUserId: a.reauthInitiatedByUserId,
    obfuscatedCredentials: a.obfuscatedCredentials,
    abilities: {
      canUpdate: a.abilities.canUpdate,
      canDelete: a.abilities.canDelete,
    },
  }));

  return {
    appAccounts,
    totalCount: appAccounts.length,
  };
}

/**
 * Set a connected app account as the default for its integration type.
 */
export async function setDefaultAppAccount(opts: {
  workspaceId: string;
  appAccountId: string;
}): Promise<SetDefaultAppAccountOutput> {
  const { workspaceId, appAccountId } = opts;

  if (
    !workspaceId ||
    typeof workspaceId === 'boolean' ||
    String(workspaceId).trim() === ''
  ) {
    throw new Validation(
      'setDefaultAppAccount: workspaceId is required and must be a non-empty string',
    );
  }
  if (
    !appAccountId ||
    typeof appAccountId === 'boolean' ||
    String(appAccountId).trim() === ''
  ) {
    throw new Validation(
      'setDefaultAppAccount: appAccountId is required and must be a non-empty string (aa_xxx format)',
    );
  }

  const data = await clayFetch<AppAccountData>(
    `/workspaces/${workspaceId}/app-accounts/accounts/${appAccountId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ setAsDefault: true }),
    },
  );

  return {
    id: data.id,
    name: data.name,
    appAccountTypeId: data.appAccountTypeId,
    isSharedPublicKey: data.isSharedPublicKey,
    userOwnerId: data.userOwnerId,
    workspaceOwnerId: data.workspaceOwnerId,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    deletedAt: data.deletedAt,
    useStaticIP: data.useStaticIP,
    reauthInitiatedAt: data.reauthInitiatedAt,
    reauthInitiatedByUserId: data.reauthInitiatedByUserId,
    obfuscatedCredentials: data.obfuscatedCredentials,
    abilities: {
      canUpdate: data.abilities.canUpdate,
      canDelete: data.abilities.canDelete,
    },
  };
}

/**
 * Update workspace settings (name).
 */
export async function updateWorkspace(
  opts: UpdateWorkspaceInput,
): Promise<UpdateWorkspaceOutput> {
  const { workspaceId, name } = opts;

  if (
    workspaceId == null ||
    typeof workspaceId === 'boolean' ||
    String(workspaceId).trim() === ''
  ) {
    throw new Validation(
      'updateWorkspace: workspaceId is required (numeric string, e.g. "980747")',
    );
  }
  if (name == null || String(name).trim() === '') {
    throw new Validation('updateWorkspace: name is required (non-empty string)');
  }

  const wsId = String(workspaceId).trim();

  const data = await clayFetch<WorkspaceDetailsResponse>(
    `/workspaces/${wsId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    },
  );

  return {
    id: data.id,
    name: data.name,
    createdByUserId: data.createdByUserId,
    icon: data.icon,
    billingPlanType: data.billingPlanType,
    billingEmail: data.billingEmail,
    customerId: data.customerId,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    deletedAt: data.deletedAt,
    billingPlanUpdatedAt: data.billingPlanUpdatedAt,
    settings: data.settings,
    featureFlags: data.featureFlags,
    credits: {
      basic: data.credits.basic,
      longExpiry: data.credits.longExpiry,
      actionExecution: data.credits.actionExecution,
    },
    creditBudgets: {
      basic: data.creditBudgets.basic,
      longExpiry: data.creditBudgets.longExpiry,
      actionExecution: data.creditBudgets.actionExecution,
    },
    currentPeriodEnd: data.currentPeriodEnd,
    centsPerCredit: data.centsPerCredit,
    onboardingData: data.onboardingData,
    abilities: data.abilities,
    audienceAbilities: data.audienceAbilities,
  };
}

/**
 * Get specific resource details by ID (workbook, table, or folder).
 */
export async function getResource(
  opts: GetResourceInput,
): Promise<GetResourceOutput> {
  const { workspaceId, resourceId, resourceType } = opts;

  if (!workspaceId) {
    throw new Validation(
      'getResource: workspaceId is required (numeric string, e.g. "980747")',
    );
  }
  if (!resourceId) {
    throw new Validation(
      'getResource: resourceId is required (e.g. "wb_xxx" for workbook, "t_xxx" for table)',
    );
  }
  if (!resourceType) {
    throw new Validation(
      'getResource: resourceType is required ("WORKBOOK", "TABLE", or "FOLDER")',
    );
  }

  const data = await clayFetch<{ resource: GetResourceResponse }>(
    `/workspaces/${workspaceId}/resources/${resourceId}?resourceType=${resourceType}`,
  );

  const r = data.resource;

  const abilities: GetResourceOutput['abilities'] = {
    canDelete: r.abilities.canDelete,
    canUpdate: r.abilities.canUpdate,
  };
  if (r.abilities.canManageAccess !== undefined)
    abilities.canManageAccess = r.abilities.canManageAccess;
  if (r.abilities.canUpdateFromSandbox !== undefined)
    abilities.canUpdateFromSandbox = r.abilities.canUpdateFromSandbox;

  const result: GetResourceOutput = {
    id: r.id,
    resourceType: r.resourceType,
    name: r.name,
    description: r.description,
    workspaceId: r.workspaceId,
    parentFolderId: r.parentFolderId,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    deletedAt: r.deletedAt,
    abilities,
    isStarred: r.isStarred,
    parentResourcePath: r.parentResourcePath,
    tags: r.tags,
  };

  // Fields present for WORKBOOK/TABLE but absent for FOLDER
  if (r.defaultAccess !== undefined) result.defaultAccess = r.defaultAccess;
  if (r.ownerId !== undefined) result.ownerId = r.ownerId;
  if (r.isHiddenFromNavigation !== undefined)
    result.isHiddenFromNavigation = r.isHiddenFromNavigation;
  if (r.owner !== undefined) result.owner = r.owner;

  // Fields present for WORKBOOK only
  if (r.settings !== undefined) result.settings = r.settings;
  if (r.annotations !== undefined) result.annotations = r.annotations;
  if (r.isHidden !== undefined) result.isHidden = r.isHidden;
  if (r.creditLimit !== undefined) result.creditLimit = r.creditLimit;
  if (r.lastOpenedAt !== undefined) result.lastOpenedAt = r.lastOpenedAt;

  return result;
}

/**
 * Log resource activity (view/open) - updates lastOpenedAt timestamp.
 */
export async function logResourceActivity(
  opts: LogResourceActivityInput,
): Promise<LogResourceActivityOutput> {
  const { workspaceId, resourceId, resourceType, activityType } = opts;

  if (!workspaceId) {
    throw new Validation(
      'logResourceActivity: workspaceId is required (numeric string, e.g. "980747")',
    );
  }
  if (!resourceId) {
    throw new Validation(
      'logResourceActivity: resourceId is required (e.g. "wb_xxx" for workbook, "t_xxx" for table)',
    );
  }
  if (!resourceType) {
    throw new Validation(
      'logResourceActivity: resourceType is required (e.g. "WORKBOOK", "TABLE", "FOLDER")',
    );
  }
  if (!activityType) {
    throw new Validation(
      'logResourceActivity: activityType is required (currently only "LAST_OPENED")',
    );
  }

  const data = await clayFetch<{ success: boolean }>(
    `/workspaces/${workspaceId}/resources/${resourceId}/activity`,
    {
      method: 'POST',
      body: JSON.stringify({ resourceType, activityType }),
    },
  );

  return { success: data.success };
}

/**
 * Remove a user from the workspace by user ID.
 * Looks up the user's role assignment, then deletes the permission.
 */
export async function removeWorkspaceUser(
  opts: RemoveWorkspaceUserInput,
): Promise<RemoveWorkspaceUserOutput> {
  const { workspaceId, userId } = opts;

  if (
    workspaceId == null ||
    typeof workspaceId === 'boolean' ||
    String(workspaceId).trim() === ''
  ) {
    throw new Validation(
      'removeWorkspaceUser: workspaceId is required (numeric string, e.g. "983537")',
    );
  }
  if (
    userId == null ||
    typeof userId === 'boolean' ||
    String(userId).trim() === ''
  ) {
    throw new Validation(
      'removeWorkspaceUser: userId is required (numeric string from listWorkspaceMembers, e.g. "1152423")',
    );
  }

  const wsId = String(workspaceId).trim();
  const uid = String(userId).trim();

  // Look up the user's roleId from workspace permissions
  const permissions = await clayFetch<{
    userPermissions: Array<{
      roleId: string;
      pending: boolean;
      user: { id: number } | null;
      role: { id: string; role: string };
    }>;
  }>(`/workspaces/${wsId}/permissions`);

  const match = (permissions.userPermissions || []).find(
    (p) => p.user && String(p.user.id) === uid,
  );
  if (!match) {
    throw new NotFound(
      `removeWorkspaceUser: userId ${uid} not found in workspace ${wsId}. Use listWorkspaceMembers to get valid user IDs.`,
    );
  }

  // Prevent removing the workspace owner
  if (match.role?.role === 'workspace-admin' && !match.pending) {
    throw new PermissionDenied(
      'removeWorkspaceUser: cannot remove the workspace owner (role: workspace-admin). This would lock the owner out permanently.',
    );
  }

  await clayFetch(`/permissions/${match.roleId}`, {
    method: 'DELETE',
    body: JSON.stringify({ permissionId: match.roleId }),
  });

  return { success: true };
}

/**
 * Get auth token for Knock.app notifications service.
 */
export async function getKnockToken(): Promise<GetKnockTokenOutput> {
  const data = await clayFetch<{ token: string }>('/auth/knock/token');
  return { token: data.token };
}

/**
 * Get credit accrual/rewards info for workspace.
 */
export async function getCreditAccrual(
  opts: GetCreditAccrualInput,
): Promise<GetCreditAccrualOutput> {
  const { workspaceId, rewardsOnly } = opts;

  if (!workspaceId) {
    throw new Validation('getCreditAccrual: workspaceId is required');
  }

  const params = new URLSearchParams();
  params.set('workspaceId', String(workspaceId));
  if (rewardsOnly !== undefined) {
    params.set('rewardsOnly', String(rewardsOnly));
  }

  const data = await clayFetch<GetCreditAccrualOutput>(
    `/credit-accrual?${params.toString()}`,
  );

  return {
    accruals: (data.accruals || []).map((a) => ({
      id: a.id,
      workspaceId: a.workspaceId,
      accrualType: a.accrualType,
      metadata: {
        type: a.metadata.type,
        balanceSnapshot: {
          balanceAfter: a.metadata.balanceSnapshot.balanceAfter,
          balanceBefore: a.metadata.balanceSnapshot.balanceBefore,
        },
      },
      createdAt: a.createdAt,
      amount: a.amount,
      creditType: a.creditType,
    })),
  };
}
