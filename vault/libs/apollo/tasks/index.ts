/**
 * Apollo Tasks Module
 *
 * CRUD operations for Apollo tasks including search, create, update, and complete.
 * Tasks cannot be deleted in Apollo; they can only be marked as complete.
 */

import { Validation, throwForStatus } from '@vallum/_runtime';

import type {
  SearchTasksInput,
  SearchTasksOutput,
  CreateTaskInput,
  CreateTaskOutput,
  UpdateTaskInput,
  UpdateTaskOutput,
  CompleteTaskInput,
  CompleteTaskOutput,
} from '../schemas';

/**
 * Search tasks with pagination and sorting.
 */
export async function searchTasks(
  opts: SearchTasksInput,
): Promise<SearchTasksOutput> {
  const {
    page = 1,
    perPage = 25,
    sortByField,
    sortAscending,
    userId,
    type,
    status,
    taskTypeCds,
  } = opts;

  const body: Record<string, unknown> = {
    page,
    per_page: perPage,
  };

  if (sortByField !== undefined) {
    body.sort_by_field = sortByField;
  }
  if (sortAscending !== undefined) {
    body.sort_ascending = sortAscending;
  }
  if (userId !== undefined) {
    body.user_id = userId;
  }
  if (type !== undefined) {
    body.type = type;
  }
  if (status !== undefined) {
    body.status = status;
  }
  if (taskTypeCds !== undefined) {
    body.task_type_cds = taskTypeCds;
  }

  const base = window.location.origin;
  const response = await fetch(`${base}/api/v1/tasks/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  return await response.json();
}

/**
 * Create a new task.
 */
export async function createTask(
  opts: CreateTaskInput,
): Promise<CreateTaskOutput> {
  const {
    type,
    priority,
    note,
    status,
    user_id,
    contact_ids,
    account_id,
    opportunity_id,
    due_at,
  } = opts;

  if (!type) throw new Validation('type is required');
  if (!priority) throw new Validation('priority is required');
  if (!note) throw new Validation('note is required');
  if (!status) throw new Validation('status is required');
  if (!user_id)
    throw new Validation('user_id is required - get it from getContext()');

  const body: Record<string, unknown> = {
    type,
    priority,
    note,
    status,
    user_id,
  };

  if (contact_ids !== undefined) body.contact_ids = contact_ids;
  if (account_id !== undefined) body.account_id = account_id;
  if (opportunity_id !== undefined) body.opportunity_id = opportunity_id;
  if (due_at !== undefined) body.due_at = due_at;

  const base = window.location.origin;
  const response = await fetch(`${base}/api/v1/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  return await response.json();
}

/**
 * Update an existing task (priority, note, due_at).
 * To mark a task complete, use completeTask() instead.
 */
export async function updateTask(
  opts: UpdateTaskInput,
): Promise<UpdateTaskOutput> {
  const { id, priority, note, due_at } = opts;

  if (!id) throw new Validation('id is required');

  const body: Record<string, unknown> = {};
  if (priority !== undefined) body.priority = priority;
  if (note !== undefined) body.note = note;
  if (due_at !== undefined) body.due_at = due_at;

  const base = window.location.origin;
  const response = await fetch(`${base}/api/v1/tasks/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  return await response.json();
}

/**
 * Mark a task as complete.
 * Sequence tasks (emailer_campaign_id present) require PUT with status:complete.
 * Standalone tasks use POST /complete.
 */
export async function completeTask(
  opts: CompleteTaskInput,
): Promise<CompleteTaskOutput> {
  const { id, isSequenceTask = false } = opts;

  if (!id) throw new Validation('id is required');

  const base = window.location.origin;

  if (isSequenceTask) {
    const response = await fetch(`${base}/api/v1/tasks/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ status: 'complete' }),
    });

    if (!response.ok)
      throwForStatus(response.status, await response.text().catch(() => undefined));

    return await response.json();
  }

  const response = await fetch(`${base}/api/v1/tasks/${id}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  return await response.json();
}
