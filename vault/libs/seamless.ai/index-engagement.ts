/**
 * Seamless.AI Engagement Functions
 *
 * Outreach campaigns, tasks, activities, and template folders.
 * All endpoints are org-scoped: /api/users/orgs/{orgId}/engagements/...
 */

import type {
  ListCampaignsInput,
  ListCampaignsOutput,
  ListTasksInput,
  ListTasksOutput,
  ListActivitiesInput,
  ListActivitiesOutput,
  ListTemplateFoldersInput,
  ListTemplateFoldersOutput,
  GetCampaignInput,
  GetCampaignOutput,
  CreateCampaignInput,
  CreateCampaignOutput,
  CreateTaskInput,
  CreateTaskOutput,
  UpdateTaskInput,
  UpdateTaskOutput,
} from './schemas-engagement';

import { Validation, NotFound } from '@vallum/_runtime';
import { seamlessGet, seamlessPost, seamlessPut, API_BASE } from './helpers';

// ============================================================================
// listCampaigns
// ============================================================================

export async function listCampaigns(
  params: ListCampaignsInput,
): Promise<ListCampaignsOutput> {
  const limit = params.limit ?? 50;
  const offset = params.offset ?? 0;
  const sortColumn = params.sortColumn ?? 'createdAt';
  const sortOrder = params.sortOrder ?? 'desc';

  let qs = `limit=${limit}&offset=${offset}&sortColumn=${sortColumn}&sortOrder=${sortOrder}`;
  if (params.status) qs += `&status=${encodeURIComponent(params.status)}`;
  if (params.searchText)
    qs += `&searchText=${encodeURIComponent(params.searchText)}`;

  const data = (await seamlessGet(
    `/users/orgs/${params.orgId}/engagements/campaigns?${qs}`,
  )) as Record<string, unknown>;

  const campaigns = (
    (data.campaigns ?? []) as Array<Record<string, unknown>>
  ).map((c) => ({
    id: String(c.id ?? c._id ?? ''),
    name: String(c.name ?? ''),
    status: String(c.status ?? ''),
    createdAt: String(c.createdAt ?? ''),
    updatedAt: String(c.updatedAt ?? ''),
  }));

  return {
    campaigns,
    total: Number(data.total ?? 0),
    archived: Number(data.archived ?? 0),
    numErrors: Number(data.numErrors ?? 0),
  };
}

// ============================================================================
// listTasks
// ============================================================================

export async function listTasks(
  params: ListTasksInput,
): Promise<ListTasksOutput> {
  const limit = params.limit ?? 50;
  const offset = params.offset ?? 0;
  const sortColumn = params.sortColumn ?? 'createdAt';
  const sortOrder = params.sortOrder ?? 'desc';

  const data = (await seamlessGet(
    `/users/orgs/${params.orgId}/engagements/tasks?limit=${limit}&offset=${offset}&sortColumn=${sortColumn}&sortOrder=${sortOrder}`,
  )) as Record<string, unknown>;

  const rawItems = (data.items ?? []) as Array<Record<string, unknown>>;
  const tasksCounts = (data.tasksCounts ?? {}) as Record<string, unknown>;
  const statusCounts = (tasksCounts.statusCounts ?? {}) as Record<
    string,
    unknown
  >;
  const taskTypeCounts = (tasksCounts.taskTypeCounts ?? {}) as Record<
    string,
    unknown
  >;

  const PRIORITY_LABELS: Record<number, string> = {
    0: 'none',
    1: 'low',
    2: 'medium',
    3: 'high',
  };

  const items = rawItems.map((t) => ({
    id: String(t.taskId ?? t.id ?? t._id ?? ''),
    name: t.name ? String(t.name) : undefined,
    taskType: String(t.taskType ?? ''),
    status: String(t.status ?? ''),
    description: t.description ? String(t.description) : undefined,
    priority:
      t.priority != null
        ? (PRIORITY_LABELS[Number(t.priority)] ?? String(t.priority))
        : undefined,
    subject: t.subject ? String(t.subject) : undefined,
    dueAt: t.dueAt ? String(t.dueAt) : undefined,
    contactId: t.contactId ? String(t.contactId) : undefined,
    campaignId: t.campaignId ? String(t.campaignId) : undefined,
    createdAt: t.createdAt ? String(t.createdAt) : undefined,
    updatedAt: t.updatedAt ? String(t.updatedAt) : undefined,
  }));

  return {
    items,
    count: Number(data.count ?? items.length),
    tasksCounts: {
      totalCount: Number(tasksCounts.totalCount ?? 0),
      statusCounts: {
        DRAFT: Number(statusCounts.DRAFT ?? 0),
        TODO: Number(statusCounts.TODO ?? 0),
        QUEUED: Number(statusCounts.QUEUED ?? 0),
        SCHEDULED: Number(statusCounts.SCHEDULED ?? 0),
        STARTED: Number(statusCounts.STARTED ?? 0),
        RETRYING: Number(statusCounts.RETRYING ?? 0),
        PAUSED: Number(statusCounts.PAUSED ?? 0),
        COMPLETED: Number(statusCounts.COMPLETED ?? 0),
        PASTDUE: Number(statusCounts.PASTDUE ?? 0),
        ARCHIVED: Number(statusCounts.ARCHIVED ?? 0),
        ERROR: Number(statusCounts.ERROR ?? 0),
        CANCELED: Number(statusCounts.CANCELED ?? 0),
        SKIPPED: Number(statusCounts.SKIPPED ?? 0),
        DUE_TODAY: Number(statusCounts.DUE_TODAY ?? 0),
        DELETED: Number(statusCounts.DELETED ?? 0),
      },
      taskTypeCounts: {
        email: Number(taskTypeCounts.email ?? 0),
        'auto-email': Number(taskTypeCounts['auto-email'] ?? 0),
        'manual-email': Number(taskTypeCounts['manual-email'] ?? 0),
        bulkEmail: Number(taskTypeCounts.bulkEmail ?? 0),
        call: Number(taskTypeCounts.call ?? 0),
        linkedIn: Number(taskTypeCounts.linkedIn ?? 0),
        'linkedin-message': Number(taskTypeCounts['linkedin-message'] ?? 0),
        'linkedin-connect-request': Number(
          taskTypeCounts['linkedin-connect-request'] ?? 0,
        ),
        custom: Number(taskTypeCounts.custom ?? 0),
        default: Number(taskTypeCounts.default ?? 0),
      },
      isDueCount: Number(tasksCounts.isDueCount ?? 0),
      activeInCampaign: Number(tasksCounts.activeInCampaign ?? 0),
      totalInCampaign: Number(tasksCounts.totalInCampaign ?? 0),
    },
  };
}

// ============================================================================
// listActivities
// ============================================================================

export async function listActivities(
  params: ListActivitiesInput,
): Promise<ListActivitiesOutput> {
  const limit = params.limit ?? 50;
  const offset = params.offset ?? 0;
  const sortColumn = params.sortColumn ?? 'createdAt';
  const sortOrder = params.sortOrder ?? 'desc';

  const data = (await seamlessGet(
    `/users/orgs/${params.orgId}/engagements/activities?limit=${limit}&offset=${offset}&sortColumn=${sortColumn}&sortOrder=${sortOrder}`,
  )) as Record<string, unknown>;

  const inner = (data.data ?? data) as Record<string, unknown>;
  const activityStats = (inner.activityStats ?? {}) as Record<string, unknown>;
  const rawActivityData = (inner.activityData ?? []) as Array<
    Record<string, unknown>
  >;

  const activityData = rawActivityData.map((a) => ({
    id: String(a.id ?? a._id ?? ''),
    type: String(a.type ?? a.taskType ?? ''),
    subject: a.subject ? String(a.subject) : undefined,
    contactId: a.contactId ? String(a.contactId) : undefined,
    createdAt: a.createdAt ? String(a.createdAt) : undefined,
    status: a.status ? String(a.status) : undefined,
  }));

  return {
    activityData,
    activityStats: {
      sentEmails: Number(activityStats.sentEmails ?? 0),
      scheduledEmails: Number(activityStats.scheduledEmails ?? 0),
      receivedEmails: Number(activityStats.receivedEmails ?? 0),
      openedEmails: Number(activityStats.openedEmails ?? 0),
      bouncedEmails: Number(activityStats.bouncedEmails ?? 0),
      repliedEmails: Number(activityStats.repliedEmails ?? 0),
      totalCalls: Number(activityStats.totalCalls ?? 0),
      answeredCalls: Number(activityStats.answeredCalls ?? 0),
      receivedCalls: Number(activityStats.receivedCalls ?? 0),
      callsWithPositiveSentiment: Number(
        activityStats.callsWithPositiveSentiment ?? 0,
      ),
      missedCalls: Number(activityStats.missedCalls ?? 0),
      voicemails: Number(activityStats.voicemails ?? 0),
      unsubscribedEmails: Number(activityStats.unsubscribedEmails ?? 0),
      emailsWithMissingVars: Number(activityStats.emailsWithMissingVars ?? 0),
      pausedEmails: Number(activityStats.pausedEmails ?? 0),
      skippedEmails: Number(activityStats.skippedEmails ?? 0),
      awaitingFollowup: Number(activityStats.awaitingFollowup ?? 0),
      numErrors: Number(activityStats.numErrors ?? 0),
      activeInCampaign: Number(activityStats.activeInCampaign ?? 0),
      totalEmails: Number(activityStats.totalEmails ?? 0),
      totalActivityThreadCount: Number(
        activityStats.totalActivityThreadCount ?? 0,
      ),
    },
  };
}

// ============================================================================
// listTemplateFolders
// ============================================================================

export async function listTemplateFolders(
  params: ListTemplateFoldersInput,
): Promise<ListTemplateFoldersOutput> {
  const data = (await seamlessGet(
    `/users/orgs/${params.orgId}/engagements/templates/folders`,
  )) as Record<string, unknown>;

  const items = (data.items ?? []) as Array<Record<string, unknown>>;

  const folders = items.map((f) => ({
    templateFolderId: Number(f.templateFolderId ?? 0),
    folderPath: String(f.folderPath ?? ''),
    icon: String(f.icon ?? ''),
    templatesCount: Number(f.templatesCount ?? 0),
  }));

  return { folders };
}

// ============================================================================
// getCampaign
// ============================================================================

export async function getCampaign(
  params: GetCampaignInput,
): Promise<GetCampaignOutput> {
  // Step 1: Resolve the alphanumeric identifier (required by /campaigns/details endpoint)
  let identifier = params.identifier;
  if (!identifier) {
    // No identifier provided; fetch the campaigns list to find it
    let found: Record<string, unknown> | undefined;
    let offset = 0;
    const limit = 100;

    while (!found) {
      const data = (await seamlessGet(
        `/users/orgs/${params.orgId}/engagements/campaigns?limit=${limit}&offset=${offset}&sortColumn=createdAt&sortOrder=desc`,
      )) as Record<string, unknown>;

      const campaigns = (data.campaigns ?? []) as Array<
        Record<string, unknown>
      >;
      found = campaigns.find(
        (c) =>
          String(c.id ?? '') === params.campaignId ||
          String(c.identifier ?? '') === params.campaignId,
      );

      if (found) break;

      const total = Number(data.total ?? 0);
      offset += limit;
      if (offset >= total || campaigns.length === 0) break;
    }

    if (!found) {
      throw new NotFound(
        `getCampaign: Campaign ${params.campaignId} not found. URL: ${API_BASE}/users/orgs/${params.orgId}/engagements/campaigns`,
      );
    }
    identifier = String(found.identifier ?? '');
  }

  // Step 2: Fetch full campaign details via dedicated endpoint
  const detailsData = (await seamlessGet(
    `/users/orgs/${params.orgId}/engagements/campaigns/details?identifier=${encodeURIComponent(identifier)}`,
  )) as Record<string, unknown>;

  const campaign = (detailsData.data ?? detailsData) as Record<string, unknown>;
  const scheduleDataRaw = campaign.scheduleData as Record<
    string,
    unknown
  > | null;

  return {
    id: String(campaign.id ?? ''),
    identifier: String(campaign.identifier ?? identifier),
    name: String(campaign.name ?? ''),
    status: String(campaign.status ?? ''),
    createdAt: String(campaign.createdAt ?? ''),
    startedAt: campaign.startedAt != null ? String(campaign.startedAt) : null,
    pausedAt: campaign.pausedAt != null ? String(campaign.pausedAt) : null,
    completedAt:
      campaign.completedAt != null ? String(campaign.completedAt) : null,
    archivedAt:
      campaign.archivedAt != null ? String(campaign.archivedAt) : null,
    deletedAt: campaign.deletedAt != null ? String(campaign.deletedAt) : null,
    ownerName: String(campaign.ownerName ?? ''),
    userIdOwner: campaign.userIdOwner
      ? String(campaign.userIdOwner)
      : undefined,
    scheduleId:
      campaign.scheduleId != null ? Number(campaign.scheduleId) : undefined,
    scheduleName: String(campaign.scheduleName ?? ''),
    scheduleData: scheduleDataRaw
      ? {
          days: (scheduleDataRaw.days ?? {}) as Record<string, unknown>,
          timezone: String(scheduleDataRaw.timezone ?? ''),
        }
      : undefined,
    numContacts: Number(campaign.numContacts ?? 0),
    numActive: Number(campaign.numActive ?? 0),
    numPaused: Number(campaign.numPaused ?? 0),
    numCompleted:
      campaign.numCompleted != null ? Number(campaign.numCompleted) : null,
    numRemoved:
      campaign.numRemoved != null ? Number(campaign.numRemoved) : undefined,
    numOptedOut:
      campaign.numOptedOut != null ? Number(campaign.numOptedOut) : undefined,
    closedWon:
      campaign.closedWon != null ? Number(campaign.closedWon) : undefined,
    numSteps: Number(campaign.numSteps ?? 0),
    numDays: campaign.numDays != null ? Number(campaign.numDays) : null,
    numEmails: campaign.numEmails != null ? Number(campaign.numEmails) : null,
    numOpens: campaign.numOpens != null ? Number(campaign.numOpens) : null,
    numReplies:
      campaign.numReplies != null ? Number(campaign.numReplies) : null,
    numBounces:
      campaign.numBounces != null ? Number(campaign.numBounces) : null,
    numSent: campaign.numSent != null ? Number(campaign.numSent) : null,
    numSkipped:
      campaign.numSkipped != null ? Number(campaign.numSkipped) : null,
    numCalls: campaign.numCalls != null ? Number(campaign.numCalls) : null,
    numPositive:
      campaign.numPositive != null ? Number(campaign.numPositive) : null,
    numErrors: campaign.numErrors != null ? Number(campaign.numErrors) : null,
    numEmailsScheduledToday:
      campaign.numEmailsScheduledToday != null
        ? Number(campaign.numEmailsScheduledToday)
        : null,
    numEmailsSentToday:
      campaign.numEmailsSentToday != null
        ? Number(campaign.numEmailsSentToday)
        : null,
    isPublic:
      campaign.isPublic != null ? Boolean(campaign.isPublic) : undefined,
    isTestCampaign:
      campaign.isTestCampaign != null
        ? Boolean(campaign.isTestCampaign)
        : undefined,
    excludeHolidays:
      campaign.excludeHolidays != null
        ? Boolean(campaign.excludeHolidays)
        : undefined,
    dailyEmailLimit:
      campaign.dailyEmailLimit != null
        ? Number(campaign.dailyEmailLimit)
        : null,
    useDailyEmailLimit:
      campaign.useDailyEmailLimit != null
        ? Boolean(campaign.useDailyEmailLimit)
        : undefined,
    removeUnsubscribedContacts:
      campaign.removeUnsubscribedContacts != null
        ? Boolean(campaign.removeUnsubscribedContacts)
        : undefined,
    externalProviderAccountIds:
      campaign.externalProviderAccountIds != null
        ? (campaign.externalProviderAccountIds as string[])
        : null,
    tagNames:
      campaign.tagNames != null ? (campaign.tagNames as string[]) : null,
    tagIds: campaign.tagIds != null ? (campaign.tagIds as string[]) : null,
    notifyContactsAdded:
      campaign.notifyContactsAdded != null
        ? Boolean(campaign.notifyContactsAdded)
        : undefined,
    notifyContactsRemoved:
      campaign.notifyContactsRemoved != null
        ? Boolean(campaign.notifyContactsRemoved)
        : undefined,
    notifyContactCompletedCampaign:
      campaign.notifyContactCompletedCampaign != null
        ? Boolean(campaign.notifyContactCompletedCampaign)
        : undefined,
    notifyCampaignStatusChanged:
      campaign.notifyCampaignStatusChanged != null
        ? Boolean(campaign.notifyCampaignStatusChanged)
        : undefined,
    notifyCampaignCompleted:
      campaign.notifyCampaignCompleted != null
        ? Boolean(campaign.notifyCampaignCompleted)
        : undefined,
    emailFooterId:
      campaign.emailFooterId != null ? String(campaign.emailFooterId) : null,
    isFooterEnabled:
      campaign.isFooterEnabled != null
        ? Boolean(campaign.isFooterEnabled)
        : undefined,
    selectedContactIds:
      campaign.selectedContactIds != null
        ? (campaign.selectedContactIds as string[])
        : undefined,
    steps:
      campaign.steps != null
        ? (campaign.steps as Array<Record<string, unknown>>)
        : undefined,
    isSelectedCampaign:
      campaign.isSelectedCampaign != null
        ? Boolean(campaign.isSelectedCampaign)
        : undefined,
  };
}

// ============================================================================
// createCampaign
// ============================================================================

export async function createCampaign(
  params: CreateCampaignInput,
): Promise<CreateCampaignOutput> {
  // Auto-detect default schedule if not provided
  let scheduleId = params.scheduleId;
  if (!scheduleId) {
    const schedData = (await seamlessGet(
      `/users/orgs/${params.orgId}/engagements/campaigns/schedule`,
    )) as Record<string, unknown>;
    const inner = (schedData.data ?? schedData) as Record<string, unknown>;
    const schedules = (inner.schedules ?? []) as Array<Record<string, unknown>>;
    const defaultSched = schedules.find((s) => s.isDefault) ?? schedules[0];
    if (defaultSched) {
      scheduleId = Number(defaultSched.id);
    }
  }

  const body: Record<string, unknown> = {
    name: params.name,
    userIdOwner: params.userId,
    contactIds: params.contactIds ?? [],
    listIds: params.listIds ?? [],
  };
  if (scheduleId) body.scheduleId = scheduleId;
  if (params.tagIds !== undefined) body.tagIds = params.tagIds;
  if (params.externalProviderAccountIds !== undefined) {
    body.externalProviderAccountIds = params.externalProviderAccountIds;
  }
  if (params.isPublic !== undefined) body.isPublic = params.isPublic;

  const data = (await seamlessPost(
    `/users/orgs/${params.orgId}/engagements/campaigns`,
    body,
  )) as Record<string, unknown>;

  const campaign = (data.data ?? data) as Record<string, unknown>;

  return {
    id: String(campaign.id ?? ''),
    identifier: String(campaign.identifier ?? ''),
    name: String(campaign.name ?? params.name),
    status: String(campaign.status ?? 'draft'),
    createdAt: String(campaign.createdAt ?? ''),
    isPublic: Boolean(campaign.isPublic ?? false),
    isTestCampaign: Boolean(campaign.isTestCampaign ?? false),
  };
}

// ============================================================================
// createTask
// ============================================================================

export async function createTask(
  params: CreateTaskInput,
): Promise<CreateTaskOutput> {
  // Validate taskType: the API silently accepts any string, so we enforce the enum here
  const VALID_TASK_TYPES = [
    'email',
    'auto-email',
    'manual-email',
    'call',
    'linkedIn',
    'linkedin-message',
    'linkedin-connect-request',
    'custom',
  ] as const;
  if (!(VALID_TASK_TYPES as readonly string[]).includes(params.taskType)) {
    throw new Validation(
      `createTask: invalid taskType "${params.taskType}". Must be one of: ${VALID_TASK_TYPES.join(', ')}`,
    );
  }

  // Validate name: empty string is accepted by the API but creates a nameless task
  if (!params.name || !params.name.trim()) {
    throw new Validation(`createTask: name cannot be empty`);
  }

  // Validate status: the API silently accepts arbitrary strings, so we enforce the enum here
  const VALID_STATUSES = ['DRAFT', 'TODO', 'SCHEDULED'] as const;
  const status = params.status ?? 'TODO';
  if (!(VALID_STATUSES as readonly string[]).includes(status)) {
    throw new Validation(
      `createTask: invalid status "${status}". Must be one of: ${VALID_STATUSES.join(', ')}`,
    );
  }

  // Priority mapping: API requires integers (none=0, low=1, medium=2, high=3)
  const priorityMap: Record<string, number> = {
    none: 0,
    low: 1,
    medium: 2,
    high: 3,
  };
  if (params.priority !== undefined && !(params.priority in priorityMap)) {
    throw new Validation(
      `createTask: invalid priority "${params.priority}". Must be one of: none, low, medium, high`,
    );
  }
  const priorityNum =
    params.priority !== undefined ? priorityMap[params.priority] : undefined;

  // dueAt is the correct API field; accept dueDate as legacy alias
  const dueAt = params.dueAt ?? params.dueDate;

  const body: Record<string, unknown> = {
    name: params.name,
    taskType: params.taskType,
    status,
  };
  if (params.subject) body.subject = params.subject;
  if (dueAt) body.dueAt = dueAt;
  if (params.description) body.description = params.description;
  if (priorityNum !== undefined) body.priority = priorityNum;
  if (params.contactId) body.contactId = params.contactId;
  if (params.userIdAssignee) body.userIdAssignee = params.userIdAssignee;
  if (params.tagIds !== undefined) body.tagIds = params.tagIds;
  if (params.templateId) body.templateId = params.templateId;
  if (params.isAutomated !== undefined) body.isAutomated = params.isAutomated;
  if (params.parentTaskId) body.parentTaskId = params.parentTaskId;
  if (params.campaignStepId) body.campaignStepId = params.campaignStepId;

  const data = (await seamlessPost(
    `/users/orgs/${params.orgId}/engagements/tasks`,
    body,
  )) as Record<string, unknown>;

  const taskData = data.data as Record<string, unknown> | null;

  return {
    success: (data.success as boolean) ?? true,
    taskName: params.name,
    taskId: taskData?.taskId ? String(taskData.taskId) : undefined,
  };
}

// ============================================================================
// updateTask
// ============================================================================

export async function updateTask(
  params: UpdateTaskInput,
): Promise<UpdateTaskOutput> {
  // Priority mapping: API requires integers (none=0, low=1, medium=2, high=3)
  const priorityMap: Record<string, number> = {
    none: 0,
    low: 1,
    medium: 2,
    high: 3,
  };

  // dueAt is the correct API field; accept dueDate as legacy alias
  const dueAt = params.dueAt ?? params.dueDate;

  const body: Record<string, unknown> = {
    taskType: params.taskType,
  };
  if (params.name) body.name = params.name;
  if (dueAt) body.dueAt = dueAt;
  if (params.description) body.description = params.description;
  if (params.priority !== undefined) {
    body.priority = priorityMap[params.priority] ?? 0;
  }

  await seamlessPut(
    `/users/orgs/${params.orgId}/engagements/tasks/${params.taskId}`,
    body,
  );

  // Read back the task from the list to verify the write and return updated values.
  // The single-task GET endpoint only returns {success: true}, so we must use listTasks.
  const PRIORITY_LABELS: Record<number, string> = {
    0: 'none',
    1: 'low',
    2: 'medium',
    3: 'high',
  };

  let updatedTask: Record<string, unknown> | undefined;
  let offset = 0;
  const pageSize = 50;
  // Search up to 200 tasks (most accounts have far fewer)
  for (let page = 0; page < 4 && !updatedTask; page++) {
    const listData = (await seamlessGet(
      `/users/orgs/${params.orgId}/engagements/tasks?limit=${pageSize}&offset=${offset}&sortColumn=updatedAt&sortOrder=desc`,
    )) as Record<string, unknown>;
    const rawItems = (listData.items ?? []) as Array<Record<string, unknown>>;
    updatedTask = rawItems.find(
      (t) =>
        String(t.taskId ?? t.id ?? '') === params.taskId ||
        String(t.id ?? '') === params.taskId,
    );
    if (rawItems.length < pageSize) break;
    offset += pageSize;
  }

  if (!updatedTask) {
    return { success: true, taskId: params.taskId };
  }

  return {
    success: true,
    taskId: params.taskId,
    name: updatedTask.name ? String(updatedTask.name) : undefined,
    description: updatedTask.description
      ? String(updatedTask.description)
      : undefined,
    priority:
      updatedTask.priority != null
        ? (PRIORITY_LABELS[Number(updatedTask.priority)] ??
          String(updatedTask.priority))
        : undefined,
    dueAt: updatedTask.dueAt ? String(updatedTask.dueAt) : undefined,
    updatedAt: updatedTask.updatedAt
      ? String(updatedTask.updatedAt)
      : undefined,
  };
}
