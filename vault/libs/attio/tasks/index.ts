import { attioFetch } from '../helpers';
import { NotFound, ContractDrift } from '@vallum/_runtime';
import type { ParticleMrlResponse } from '../helpers';
import type {
  ListTasksOutput,
  GetTaskOutput,
  CreateTaskOutput,
  UpdateTaskOutput,
  DeleteTaskOutput,
} from './schemas';

// v1 response from POST /tasks (create)
interface RawTaskV1Response {
  id: string;
  title: string;
  deadline_at: string | null;
  visibility: string;
  created_at: string;
  created_by: string;
  assignments: Array<Record<string, unknown>>;
  completed_at: string | null;
}

// v2 response from GET /tasks/v2 (list/get)
interface RawTaskV2Response {
  task_id: string;
  title: string;
  deadline_at: string | null;
  created_at: string;
  created_by: { type: string; id: string };
  completed_by: { type: string; id: string } | null;
  completed_at: string | null;
  assignments: Array<Record<string, unknown>>;
  references: unknown[];
}

function extractAssignees(
  assignments: Array<Record<string, unknown>>,
): string[] {
  const ids: string[] = [];
  for (const a of assignments) {
    const id =
      (a.workspace_member_id as string | undefined) ??
      (a.actor_id as string | undefined) ??
      (a.user_id as string | undefined) ??
      (a.id as string | undefined);
    if (id && typeof id === 'string') ids.push(id);
  }
  return ids;
}

function mapTaskV2(raw: RawTaskV2Response): GetTaskOutput {
  const assignees = Array.isArray(raw.assignments)
    ? extractAssignees(raw.assignments)
    : [];

  return {
    taskId: raw.task_id,
    title: raw.title,
    deadlineAt: raw.deadline_at ?? undefined,
    visibility: 'public',
    createdAt: raw.created_at,
    createdBy: raw.created_by?.id,
    completedAt: raw.completed_at ?? undefined,
    assignees: assignees.length > 0 ? assignees : undefined,
  };
}

interface AttributeDefsResponse {
  value: Array<{
    attribute_definition_id: string;
    entity_definition_id: string;
    system_attribute?: { type: string };
  }>;
}

function buildCompletionFilter(
  taskDefId: string,
  completionAttrId: string,
  completed: boolean,
): Record<string, unknown> {
  return {
    path: [
      {
        attribute_definition_id: completionAttrId,
        entity_definition_id: taskDefId,
      },
    ],
    mode: completed ? 'must' : 'must-not',
    constraints: [
      { field: 'value', operator: 'eq', value: true },
      { field: 'active_until', operator: 'empty', value: 'null' },
    ],
  };
}

/**
 * List tasks in the workspace using the Particle API + v2 batch-fetch.
 * Discovers the completion attribute dynamically, then queries for both
 * completed and not-completed tasks (Particle API requires attribute filters).
 */
export async function listTasks(opts: {
  slug: string;
  taskEntityDefId: string;
  assigneeId?: string;
  completed?: boolean;
  limit?: number;
}): Promise<ListTasksOutput> {
  const limit = opts.limit ?? 100;
  const mrlUrl = `/api/common/particle/workspaces/${opts.slug}/entity-definitions/${opts.taskEntityDefId}/entity-instances/mrl`;

  // Step 1: Discover task attribute definitions to find the completion checkbox
  const attrResp = await attioFetch<AttributeDefsResponse>(
    `/api/common/workspaces/${opts.slug}/entity-definitions/${opts.taskEntityDefId}/attribute-definitions`,
  );
  const attrs = attrResp?.value ?? [];
  const completionAttr = attrs.find(
    (a) => a.system_attribute?.type === 'task-completed',
  );
  if (!completionAttr) {
    throw new ContractDrift(
      `Could not find task-completed attribute for entity definition ${opts.taskEntityDefId}`,
    );
  }
  const completionAttrId = completionAttr.attribute_definition_id;

  // Step 2: Query task IDs via Particle MRL with attribute-based filters
  // If caller filters by completion, query only that bucket; otherwise query both
  const buckets: boolean[] =
    opts.completed !== undefined ? [opts.completed] : [false, true];

  const allIds: string[] = [];
  for (const isCompleted of buckets) {
    const mrlResp = await attioFetch<ParticleMrlResponse>(mrlUrl, {
      method: 'POST',
      body: JSON.stringify({
        filter: {
          and: [
            buildCompletionFilter(
              opts.taskEntityDefId,
              completionAttrId,
              isCompleted,
            ),
          ],
        },
        sorts: [],
        initialRange: { start: 0, size: limit },
      }),
    });
    const ids = mrlResp.entity_instance_ids_chunk ?? [];
    allIds.push(...ids);
  }

  // Dedupe
  const uniqueIds = [...new Set(allIds)].slice(0, limit);
  if (uniqueIds.length === 0) {
    return { tasks: [] };
  }

  // Step 3: Batch-fetch task details via v2 endpoint
  const rawTasks = await attioFetch<RawTaskV2Response[]>(
    `/api/common/workspaces/${opts.slug}/tasks/v2?task_ids=${encodeURIComponent(uniqueIds.join(','))}`,
  );

  let tasks = Array.isArray(rawTasks) ? rawTasks.map(mapTaskV2) : [];

  // Client-side assignee filtering
  if (opts.assigneeId !== undefined) {
    tasks = tasks.filter(
      (t) => t.assignees && t.assignees.includes(opts.assigneeId!),
    );
  }

  return { tasks };
}

/**
 * Get details of a single task by ID via the v2 endpoint.
 */
export async function getTask(opts: {
  slug: string;
  taskId: string;
}): Promise<GetTaskOutput> {
  const rawTasks = await attioFetch<RawTaskV2Response[]>(
    `/api/common/workspaces/${opts.slug}/tasks/v2?task_ids=${encodeURIComponent(opts.taskId)}`,
  );

  if (!Array.isArray(rawTasks) || rawTasks.length === 0) {
    throw new NotFound(`Task not found: ${opts.taskId}`);
  }

  return mapTaskV2(rawTasks[0]);
}

/**
 * Create a standalone task in the workspace (uses v1 endpoint).
 */
export async function createTask(opts: {
  slug: string;
  title: string;
  deadlineAt?: string;
  assigneeId?: string;
}): Promise<CreateTaskOutput> {
  const body: Record<string, unknown> = {
    title: opts.title,
    visibility: 'public',
  };

  if (opts.deadlineAt) body.deadline_at = opts.deadlineAt;
  if (opts.assigneeId) body.assignee_ids = [opts.assigneeId];

  const resp = await attioFetch<RawTaskV1Response>(
    `/api/common/workspaces/${opts.slug}/tasks`,
    { method: 'POST', body: JSON.stringify(body) },
  );

  if (!resp?.id) {
    throw new ContractDrift(
      `Unexpected task creation response: ${JSON.stringify(resp)}`,
    );
  }

  return {
    taskId: resp.id,
    title: resp.title,
    deadlineAt: resp.deadline_at ?? undefined,
    visibility: resp.visibility as 'public' | 'private',
    createdAt: resp.created_at,
    createdBy: resp.created_by,
  };
}

/**
 * Update a task: change title, assignee, deadline, or mark complete/incomplete.
 */
export async function updateTask(opts: {
  slug: string;
  taskId: string;
  title?: string;
  deadlineAt?: string | null;
  completedAt?: string | null;
  assigneeId?: string | null;
}): Promise<UpdateTaskOutput> {
  const body: Record<string, unknown> = {};

  if (opts.title !== undefined) body.title = opts.title;
  if (opts.deadlineAt !== undefined) body.deadline_at = opts.deadlineAt;
  if (opts.completedAt !== undefined) body.completed_at = opts.completedAt;
  if (opts.assigneeId !== undefined) {
    body.assignee_ids = opts.assigneeId ? [opts.assigneeId] : [];
  }

  const raw = await attioFetch<RawTaskV1Response>(
    `/api/common/workspaces/${opts.slug}/tasks/${opts.taskId}`,
    { method: 'PATCH', body: JSON.stringify(body) },
  );

  if (!raw?.id) {
    throw new ContractDrift(`Unexpected task update response: ${JSON.stringify(raw)}`);
  }

  const assignees = Array.isArray(raw.assignments)
    ? extractAssignees(raw.assignments)
    : [];

  return {
    taskId: raw.id,
    title: raw.title,
    deadlineAt: raw.deadline_at ?? undefined,
    visibility: raw.visibility as 'public' | 'private',
    createdAt: raw.created_at,
    createdBy: raw.created_by,
    completedAt: raw.completed_at ?? undefined,
    assignees: assignees.length > 0 ? assignees : undefined,
  };
}

/**
 * Delete a task permanently.
 */
export async function deleteTask(opts: {
  slug: string;
  taskId: string;
}): Promise<DeleteTaskOutput> {
  await attioFetch<void>(
    `/api/common/workspaces/${opts.slug}/tasks/${opts.taskId}`,
    { method: 'DELETE' },
  );

  return { success: true };
}
