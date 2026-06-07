import type {
  ListThreadsInput,
  ListThreadsOutput,
  GetThreadInput,
  GetThreadOutput,
  SendChatMessageInput,
  SendChatMessageOutput,
  SearchWorkspaceInput,
  SearchWorkspaceOutput,
  GetWorkspaceInput,
  GetWorkspaceOutput,
  ListWorkspaceMembersInput,
  ListWorkspaceMembersOutput,
  ListAssistantsInput,
  ListAssistantsOutput,
  ListSchedulesInput,
  ListSchedulesOutput,
  CreateScheduleInput,
  CreateScheduleOutput,
  UpdateScheduleInput,
  UpdateScheduleOutput,
  DeleteScheduleInput,
  DeleteScheduleOutput,
} from './schemas-workspace';
import { Validation, NotFound, Unauthenticated, UpstreamError, throwForStatus } from '@vallum/_runtime';

// ============================================================================
// Constants
// ============================================================================

const TRPC_BASE = 'https://gateway.prod.day.ai/trpc';
const GRAPHQL_URL = 'https://day.ai/api/graphql';
const SUPABASE_TOKEN_KEY = 'sb-ffdfsbwhgoaivsfgdupn-auth-token';

// ============================================================================
// Helpers
// ============================================================================

interface TrpcResponse<T> {
  result: { data: T };
}

async function trpcCall<T>(
  accessToken: string,
  procedure: string,
  body: Record<string, unknown>,
): Promise<T> {
  const resp = await fetch(`${TRPC_BASE}/${procedure}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    const truncated =
      text.length > 2000 ? text.slice(0, 2000) + '... [truncated]' : text;
    throwForStatus(resp.status, truncated);
  }

  const json = (await resp.json()) as TrpcResponse<T>;
  return json.result.data;
}

async function graphqlCall<T>(
  accessToken: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const resp = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'auth-provider': 'supabase',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throwForStatus(resp.status, text);
  }

  const json = (await resp.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };
  if (json.errors?.length) {
    throw new UpstreamError(
      `Day.ai GraphQL error: ${json.errors.map((e) => e.message).join(', ')}`,
    );
  }

  return json.data as T;
}

// ============================================================================
// GraphQL Query Strings
// ============================================================================

const GET_USER_ASSISTANTS_QUERY = `
  query GetUserAssistants($workspaceId: String!) {
    userAssistants(workspaceId: $workspaceId) {
      id workspaceId firstName lastName photoUrl title description
      ownerId tierId
      schedules {
        id name enabled scheduleType timeOfDay timezone prompt instructions
        preferredModel preferredTemperature notificationTarget templateIds
        assistantId createdAt updatedAt lastRunAt nextRunAt lastRunStatus goalId runCount
      }
      tier { id name schedules }
      instructions { id toolId instructions }
      eventInstructions { id instructions eventId }
    }
  }
`;

const GET_ASSISTANT_SCHEDULES_QUERY = `
  query GetAssistantSchedules($workspaceId: String!, $assistantId: String!) {
    assistantSchedules(workspaceId: $workspaceId, assistantId: $assistantId) {
      id name enabled scheduleType timeOfDay timezone prompt instructions
      preferredModel preferredTemperature notificationTarget templateIds
      assistantId createdAt updatedAt lastRunAt nextRunAt lastRunStatus goalId runCount
    }
  }
`;

const FETCH_WORKSPACES_AND_ROLES_QUERY = `
  query FetchWorkspacesAndRoles($userEmail: String!) {
    workspaces(userEmail: $userEmail) {
      id name status setupStatus createdByUserId creatorEmail isDefault
      domains { domain autoInvite autoInviteRoleId }
      members {
        id email status isDefaultOwner roleId invitedAt invitedBy
        coreContact { firstName lastName email photo title description linkedInUrl timezone travelTimezone domain twitterUrl facebookUrl githubUrl }
      }
      roles {
        id name description
        permissions { type permission scope }
      }
    }
  }
`;

const CREATE_THREAD_MUTATION = `
  mutation CreateThreadAsync(
    $workspaceId: String!, $threadId: String!,
    $timezone: String!, $assistantId: String, $userId: String
  ) {
    createThreadAsync(
      workspaceId: $workspaceId threadId: $threadId
      timezone: $timezone assistantId: $assistantId userId: $userId
    )
  }
`;

const CREATE_SCHEDULE_MUTATION = `
  mutation CreateAssistantSchedule(
    $assistantId: String!, $workspaceId: String!, $schedule: AssistantScheduleInput!
  ) {
    createAssistantSchedule(
      assistantId: $assistantId workspaceId: $workspaceId schedule: $schedule
    ) {
      id name enabled scheduleType timeOfDay timezone prompt instructions
      preferredModel preferredTemperature notificationTarget templateIds
      assistantId createdAt updatedAt lastRunAt nextRunAt lastRunStatus goalId runCount
    }
  }
`;

const UPDATE_SCHEDULE_MUTATION = `
  mutation UpdateAssistantSchedule(
    $scheduleId: String!, $workspaceId: String!, $schedule: AssistantScheduleInput!
  ) {
    updateAssistantSchedule(
      scheduleId: $scheduleId workspaceId: $workspaceId schedule: $schedule
    ) {
      id name enabled scheduleType timeOfDay timezone prompt instructions
      preferredModel preferredTemperature notificationTarget templateIds
      assistantId createdAt updatedAt lastRunAt nextRunAt lastRunStatus goalId runCount
    }
  }
`;

const DELETE_SCHEDULE_MUTATION = `
  mutation DeleteAssistantSchedule($scheduleId: String!, $workspaceId: String!) {
    deleteAssistantSchedule(scheduleId: $scheduleId workspaceId: $workspaceId)
  }
`;

// ============================================================================
// Functions
// ============================================================================

/**
 * List all chat threads in the workspace.
 */
export async function listThreads(
  opts: ListThreadsInput,
): Promise<ListThreadsOutput> {
  const threads = await trpcCall<ListThreadsOutput['threads']>(
    opts.accessToken,
    'home.userThreads',
    { workspaceId: opts.workspaceId },
  );

  return { threads };
}

/**
 * Get a chat thread with all messages.
 */
export async function getThread(
  opts: GetThreadInput,
): Promise<GetThreadOutput> {
  const thread = await trpcCall<GetThreadOutput['thread']>(
    opts.accessToken,
    'chat.getThread',
    { threadId: opts.threadId, workspaceId: opts.workspaceId },
  );

  return { thread };
}

/**
 * Send a message to an AI assistant thread.
 */
export async function sendChatMessage(
  opts: SendChatMessageInput,
): Promise<SendChatMessageOutput> {
  // Validate message; schema has min(1) but enforce at runtime too since this
  // runs browser-side where schema validation isn't applied automatically
  if (!opts.message || opts.message.trim().length === 0) {
    throw new Validation('sendChatMessage: message is required and cannot be empty');
  }

  const timezone = opts.timezone ?? 'America/Los_Angeles';
  let threadId = opts.threadId;

  if (threadId) {
    // Verify the thread exists before sending; the chat API silently accepts
    // any UUID and returns 200, but a non-existent threadId breaks the polling
    // workflow (chat.getThread returns null for unknown IDs)
    const existingThread = await trpcCall<GetThreadOutput['thread'] | null>(
      opts.accessToken,
      'chat.getThread',
      { threadId, workspaceId: opts.workspaceId },
    );
    if (existingThread === null) {
      throw new NotFound(
        `sendChatMessage: thread ${threadId} not found; only pass threadId values returned from a previous sendChatMessage call or from listThreads`,
      );
    }
  } else {
    // Generate client-side UUID for the thread
    threadId = crypto.randomUUID();

    // Resolve assistantId
    let assistantId = opts.assistantId;
    if (!assistantId) {
      const raw = localStorage.getItem(SUPABASE_TOKEN_KEY);
      if (!raw) {
        throw new Unauthenticated('Not logged in to Day.ai');
      }
      const assistantsData = await graphqlCall<{
        userAssistants: Array<{ id: string }>;
      }>(opts.accessToken, GET_USER_ASSISTANTS_QUERY, {
        workspaceId: opts.workspaceId,
      });
      if (!assistantsData.userAssistants.length) {
        throw new NotFound('No assistants found in workspace');
      }
      assistantId = assistantsData.userAssistants[0].id;
    }

    // Get userId from stored token
    const raw = localStorage.getItem(SUPABASE_TOKEN_KEY);
    if (!raw) {
      throw new Unauthenticated('Not logged in to Day.ai');
    }
    const tokenData = JSON.parse(raw) as { user: { id: string } };
    const userId = tokenData.user.id;

    // Create the thread server-side
    await graphqlCall(opts.accessToken, CREATE_THREAD_MUTATION, {
      workspaceId: opts.workspaceId,
      threadId,
      userId,
      assistantId,
      timezone,
    });
  }

  // Build the chat payload; omit optional fields entirely when not provided,
  // since the backend schema rejects null values for string fields like retryMessageId
  const chatPayload: Record<string, unknown> = {
    thinkingEnabled: opts.thinkingEnabled ?? false,
    memoryEnabled: opts.memoryEnabled ?? false,
    userMessage: {
      type: 'text',
      content: { text: opts.message },
    },
    userMessageId: opts.userMessageId ?? null,
    workspaceId: opts.workspaceId,
    threadId,
    timezone,
    focusObjects: opts.focusObjects ?? [],
  };
  if (opts.retryMessageId !== undefined) {
    chatPayload.retryMessageId = opts.retryMessageId;
  }

  // Send message via tRPC batch streaming endpoint
  // Requires trpc-accept: application/jsonl to signal streaming capability (httpBatchStreamLink)
  const resp = await fetch(`${TRPC_BASE}/chat.chatv09222025?batch=1`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'trpc-accept': 'application/jsonl',
      Authorization: `Bearer ${opts.accessToken}`,
    },
    body: JSON.stringify({ '0': chatPayload }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throwForStatus(resp.status, `Failed to send message: ${text}`);
  }

  // Read first chunk to ensure server has registered the message,
  // then cancel the stream; AI continues processing asynchronously
  if (resp.body) {
    const reader = resp.body.getReader();
    try {
      await reader.read();
    } catch {
      // Stream may close immediately, that's fine
    } finally {
      reader.cancel().catch((): void => {
        // Reader may already be closed; cancel is best-effort.
        return;
      });
    }
  }

  return { threadId, status: 'sent' };
}

/**
 * Search across all workspace entities.
 */
export async function searchWorkspace(
  opts: SearchWorkspaceInput,
): Promise<SearchWorkspaceOutput> {
  const data = await trpcCall<{
    native_contact?: SearchWorkspaceOutput['contacts'];
    native_organization?: SearchWorkspaceOutput['organizations'];
    native_opportunity?: SearchWorkspaceOutput['opportunities'];
    native_page?: SearchWorkspaceOutput['pages'];
    native_pipeline?: SearchWorkspaceOutput['pipelines'];
    native_meetingrecording?: SearchWorkspaceOutput['recordings'];
    native_action?: SearchWorkspaceOutput['actions'];
  }>(opts.accessToken, 'search.recentWorkspaceObjects', {
    workspaceId: opts.workspaceId,
  });

  return {
    contacts: data.native_contact || [],
    organizations: data.native_organization || [],
    opportunities: data.native_opportunity || [],
    pages: data.native_page || [],
    pipelines: data.native_pipeline || [],
    recordings: data.native_meetingrecording || [],
    actions: data.native_action || [],
  };
}

/**
 * Get workspace configuration.
 */
export async function getWorkspace(
  opts: GetWorkspaceInput,
): Promise<GetWorkspaceOutput> {
  const data = await graphqlCall<{
    workspaces: GetWorkspaceOutput['workspace'][];
  }>(opts.accessToken, FETCH_WORKSPACES_AND_ROLES_QUERY, {
    userEmail: opts.email,
  });

  const workspace = data.workspaces.find((w) => w.id === opts.workspaceId);
  if (!workspace) {
    throw new NotFound(
      `Workspace ${opts.workspaceId} not found for email ${opts.email}`,
    );
  }

  return { workspace };
}

/**
 * List workspace members.
 */
export async function listWorkspaceMembers(
  opts: ListWorkspaceMembersInput,
): Promise<ListWorkspaceMembersOutput> {
  const raw = localStorage.getItem(SUPABASE_TOKEN_KEY);
  if (!raw) {
    throw new Unauthenticated('listWorkspaceMembers: not logged in to Day.ai');
  }
  const tokenData = JSON.parse(raw) as {
    access_token: string;
    user: { email: string };
  };

  const accessToken = opts.accessToken || tokenData.access_token;
  const userEmail = opts.email || tokenData.user.email;

  const hashParams = Object.fromEntries(
    window.location.hash
      .slice(1)
      .split(',')
      .map((p) => {
        const colonIdx = p.indexOf(':');
        return colonIdx > 0
          ? [p.slice(0, colonIdx), decodeURIComponent(p.slice(colonIdx + 1))]
          : [p, ''];
      }),
  );
  const workspaceId = opts.workspaceId || hashParams['workspaceId'];
  if (!workspaceId || !workspaceId.trim()) {
    throw new Validation(
      'listWorkspaceMembers: workspaceId is required and cannot be empty; pass the UUID from getContext() or navigate to a workspace page',
    );
  }

  const data = await graphqlCall<{
    workspaces: Array<{
      id: string;
      members: ListWorkspaceMembersOutput['members'];
    }>;
  }>(accessToken, FETCH_WORKSPACES_AND_ROLES_QUERY, {
    userEmail,
  });

  const workspace = data.workspaces.find((w) => w.id === workspaceId);
  if (!workspace) {
    throw new NotFound(
      `listWorkspaceMembers: workspace ${workspaceId} not found for email ${userEmail}`,
    );
  }

  return { members: workspace.members };
}

/**
 * List all AI assistants in the workspace.
 */
export async function listAssistants(
  opts: ListAssistantsInput,
): Promise<ListAssistantsOutput> {
  const raw = localStorage.getItem(SUPABASE_TOKEN_KEY);
  if (!raw) {
    throw new Unauthenticated('listAssistants: not logged in to Day.ai');
  }
  const tokenData = JSON.parse(raw) as { access_token: string };
  const accessToken = opts.accessToken || tokenData.access_token;

  const hashParams = Object.fromEntries(
    window.location.hash
      .slice(1)
      .split(',')
      .map((p) => {
        const colonIdx = p.indexOf(':');
        return colonIdx > 0
          ? [p.slice(0, colonIdx), decodeURIComponent(p.slice(colonIdx + 1))]
          : [p, ''];
      }),
  );
  const workspaceId = opts.workspaceId || hashParams['workspaceId'];
  if (!workspaceId) {
    throw new Validation(
      'listAssistants: workspaceId not found in opts or URL hash',
    );
  }

  const data = await graphqlCall<{
    userAssistants: ListAssistantsOutput['assistants'];
  }>(accessToken, GET_USER_ASSISTANTS_QUERY, {
    workspaceId,
  });

  return { assistants: data.userAssistants };
}

/**
 * List schedules for an AI assistant.
 */
export async function listSchedules(
  opts: ListSchedulesInput,
): Promise<ListSchedulesOutput> {
  const raw = localStorage.getItem(SUPABASE_TOKEN_KEY);
  if (!raw) {
    throw new Unauthenticated('listSchedules: not logged in to Day.ai');
  }
  const tokenData = JSON.parse(raw) as {
    access_token: string;
  };
  const accessToken = opts.accessToken || tokenData.access_token;

  const hashParams = Object.fromEntries(
    window.location.hash
      .slice(1)
      .split(',')
      .map((p) => {
        const colonIdx = p.indexOf(':');
        return colonIdx > 0
          ? [p.slice(0, colonIdx), decodeURIComponent(p.slice(colonIdx + 1))]
          : [p, ''];
      }),
  );
  const workspaceId = opts.workspaceId || hashParams['workspaceId'];
  if (!workspaceId) {
    throw new Validation('listSchedules: workspaceId not found in opts or URL hash');
  }

  const data = await graphqlCall<{
    assistantSchedules: ListSchedulesOutput['schedules'];
  }>(accessToken, GET_ASSISTANT_SCHEDULES_QUERY, {
    workspaceId,
    assistantId: opts.assistantId,
  });

  return { schedules: data.assistantSchedules };
}

/**
 * Create a new schedule for an AI assistant.
 */
export async function createSchedule(
  opts: CreateScheduleInput,
): Promise<CreateScheduleOutput> {
  const raw = localStorage.getItem(SUPABASE_TOKEN_KEY);
  if (!raw) {
    throw new Unauthenticated('createSchedule: not logged in to Day.ai');
  }
  const tokenData = JSON.parse(raw) as { access_token: string };
  const accessToken = opts.accessToken || tokenData.access_token;

  const data = await graphqlCall<{
    createAssistantSchedule: CreateScheduleOutput['schedule'];
  }>(accessToken, CREATE_SCHEDULE_MUTATION, {
    assistantId: opts.assistantId,
    workspaceId: opts.workspaceId,
    schedule: opts.schedule,
  });

  return { schedule: data.createAssistantSchedule };
}

/**
 * Update an existing schedule.
 * The GraphQL AssistantScheduleInput requires name, timezone, etc. as non-nullable.
 * This function fetches the current schedule and merges partial updates so callers
 * don't need to pass every field.
 */
export async function updateSchedule(
  opts: UpdateScheduleInput,
): Promise<UpdateScheduleOutput> {
  // Runtime validation: schema has min(1) but browser context doesn't enforce it
  if (opts.schedule.name !== undefined && opts.schedule.name.length === 0) {
    throw new Validation(
      'updateSchedule: name cannot be empty; the API accepts empty strings but creates an unusable schedule with no display name',
    );
  }

  const raw = localStorage.getItem(SUPABASE_TOKEN_KEY);
  if (!raw) {
    throw new Unauthenticated('updateSchedule: not logged in to Day.ai');
  }
  const tokenData = JSON.parse(raw) as { access_token: string };
  const accessToken = opts.accessToken || tokenData.access_token;

  // Fetch the current schedule to merge with partial updates.
  // listAssistants returns schedules nested under each assistant.
  const assistantsData = await graphqlCall<{
    userAssistants: Array<{
      id: string;
      schedules: Array<{
        id: string;
        name: string;
        enabled: boolean;
        scheduleType: string;
        timeOfDay: string;
        timezone: string;
        prompt: string | null;
        instructions: string | null;
        preferredModel: string | null;
        preferredTemperature: number | null;
        notificationTarget: string | null;
        templateIds: string[] | null;
        goalId: string | null;
      }>;
    }>;
  }>(accessToken, GET_USER_ASSISTANTS_QUERY, {
    workspaceId: opts.workspaceId,
  });

  let existingSchedule:
    | (typeof assistantsData.userAssistants)[0]['schedules'][0]
    | undefined;
  for (const asst of assistantsData.userAssistants) {
    existingSchedule = asst.schedules.find((s) => s.id === opts.scheduleId);
    if (existingSchedule) break;
  }

  if (!existingSchedule) {
    throw new NotFound(
      `updateSchedule: schedule ${opts.scheduleId} not found in workspace`,
    );
  }

  // Merge: caller's values override existing values
  const mergedSchedule = {
    name: opts.schedule.name ?? existingSchedule.name,
    timezone: opts.schedule.timezone ?? existingSchedule.timezone,
    scheduleType: opts.schedule.scheduleType ?? existingSchedule.scheduleType,
    timeOfDay: opts.schedule.timeOfDay ?? existingSchedule.timeOfDay,
    prompt: opts.schedule.prompt ?? existingSchedule.prompt,
    instructions: opts.schedule.instructions ?? existingSchedule.instructions,
    enabled: opts.schedule.enabled ?? existingSchedule.enabled,
    preferredModel:
      opts.schedule.preferredModel ?? existingSchedule.preferredModel,
    preferredTemperature:
      opts.schedule.preferredTemperature ??
      existingSchedule.preferredTemperature,
    notificationTarget:
      opts.schedule.notificationTarget ?? existingSchedule.notificationTarget,
    templateIds: opts.schedule.templateIds ?? existingSchedule.templateIds,
    goalId: opts.schedule.goalId ?? existingSchedule.goalId,
  };

  const data = await graphqlCall<{
    updateAssistantSchedule: UpdateScheduleOutput['schedule'];
  }>(accessToken, UPDATE_SCHEDULE_MUTATION, {
    scheduleId: opts.scheduleId,
    workspaceId: opts.workspaceId,
    schedule: mergedSchedule,
  });

  return { schedule: data.updateAssistantSchedule };
}

/**
 * Delete a schedule from an AI assistant.
 */
export async function deleteSchedule(
  opts: DeleteScheduleInput,
): Promise<DeleteScheduleOutput> {
  const raw = localStorage.getItem(SUPABASE_TOKEN_KEY);
  if (!raw) {
    throw new Unauthenticated('deleteSchedule: not logged in to Day.ai');
  }
  const tokenData = JSON.parse(raw) as { access_token: string };
  const accessToken = opts.accessToken || tokenData.access_token;

  const data = await graphqlCall<{
    deleteAssistantSchedule: string;
  }>(accessToken, DELETE_SCHEDULE_MUTATION, {
    scheduleId: opts.scheduleId,
    workspaceId: opts.workspaceId,
  });

  return { deletedScheduleId: data.deleteAssistantSchedule };
}
