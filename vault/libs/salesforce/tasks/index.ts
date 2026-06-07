/**
 * Salesforce Task & Note Operations
 *
 * CRUD operations for Tasks and ContentNote creation via Aura framework API.
 * Task create/update uses GraphQL mutations (RecordUiController CRUD rejects Task).
 * Task delete uses RecordUiController/deleteRecord (works with just recordId).
 */

import { Validation, NotFound, UpstreamError } from '@vallum/_runtime';
import { auraAction, DESCRIPTORS, extractGraphQLRecord, validateString } from '../aura';
import type { AuraContext, GraphQLResponse } from '../aura';
import type {
  CreateTaskInput,
  CreateTaskOutput,
  UpdateTaskInput,
  UpdateTaskOutput,
  DeleteTaskInput,
  DeleteTaskOutput,
  GetTaskInput,
  GetTaskOutput,
  ListTasksInput,
  ListTasksOutput,
} from '../schemas';

// ---------------------------------------------------------------------------
// Shared types (internal)
// ---------------------------------------------------------------------------

interface ListResult {
  result: Array<{ record: Record<string, unknown> & { Id: string } }>;
  totalCount: number;
}

interface GetRecordResult {
  record: Record<string, unknown> & { Id: string };
}

interface RecordUiResult {
  id: string;
  apiName: string;
  fields: Record<string, { displayValue: string | null; value: unknown }>;
  onLoadErrorMessage?: string;
  childRelationships?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildCtx(creds: {
  auraToken: string;
  auraContext: string;
}): AuraContext {
  return { token: creds.auraToken, context: creds.auraContext };
}


function flattenRecordUiFields(
  result: RecordUiResult,
): Record<string, unknown> {
  const record: Record<string, unknown> = { Id: result.id };
  for (const [key, field] of Object.entries(result.fields)) {
    record[key] = field.value;
  }
  return record;
}

// ---------------------------------------------------------------------------
// List Tasks
// ---------------------------------------------------------------------------

export async function listTasks(
  args: ListTasksInput,
): Promise<ListTasksOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');

  if (
    args.pageSize !== undefined &&
    (typeof args.pageSize !== 'number' || args.pageSize < 1)
  ) {
    throw new Validation('pageSize must be a positive number.');
  }

  if (
    args.page !== undefined &&
    (typeof args.page !== 'number' || args.page < 0)
  ) {
    throw new Validation('page must be a non-negative number.');
  }

  const ctx = buildCtx(args);

  const params: Record<string, unknown> = {
    entityNameOrId: 'Task',
    layoutType: args.layoutType ?? 'FULL',
    pageSize: args.pageSize ?? 25,
    currentPage: (args.page ?? 0) + 1,
    useTimeout: false,
    getCount: true,
    enableRowActions: args.enableRowActions ?? false,
  };

  if (args.sortBy !== undefined) {
    params.sortBy = args.sortBy;
  }

  if (args.filterName !== undefined) {
    params.filterName = args.filterName;
  }

  const raw = await auraAction(ctx, DESCRIPTORS.getItems, params);

  const result = raw as ListResult;

  return {
    totalCount: result.totalCount,
    tasks: result.result.map((item) => item.record),
  };
}

// ---------------------------------------------------------------------------
// Get Task
// ---------------------------------------------------------------------------

export async function getTask(args: GetTaskInput): Promise<GetTaskOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.taskId, 'taskId');

  const ctx = buildCtx(args);

  // Task is not supported by RecordUiController ("Object Task is not supported
  // in UI API"). Only DetailController works for read-only access.
  const raw = await auraAction(ctx, DESCRIPTORS.getRecord, {
    recordId: args.taskId,
    layoutType: args.layoutType ?? 'FULL',
    mode: args.mode ?? 'VIEW',
    ...(args.recordTypeId ? { recordTypeId: args.recordTypeId } : {}),
  });

  const result = raw as GetRecordResult & { onLoadErrorMessage?: string };

  if (result.onLoadErrorMessage || !result.record) {
    throw new NotFound(
      `getTask: record not found for ${args.taskId}. ${result.onLoadErrorMessage ?? ''}`.trim(),
    );
  }

  return result.record;
}

// ---------------------------------------------------------------------------
// Create Note (ContentNote)
// ---------------------------------------------------------------------------

/**
 * Create a ContentNote (rich text note) in Salesforce.
 * Content should be plain text; Salesforce stores it internally as rich text.
 */
export async function createNote(args: {
  auraToken: string;
  auraContext: string;
  title: string;
  content: string;
  sharingPrivacy?: 'N' | 'P';
  ownerId?: string;
  fields?: Record<string, unknown>;
}): Promise<{ id: string; record: Record<string, unknown> }> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.title, 'title');
  validateString(args.content, 'content');

  const ctx = buildCtx(args);

  const encodedContent = btoa(unescape(encodeURIComponent(args.content)));

  const fields: Record<string, unknown> = {
    ...args.fields,
    Title: args.title,
    Content: encodedContent,
  };

  if (args.sharingPrivacy) {
    fields.SharingPrivacy = args.sharingPrivacy;
  }
  if (args.ownerId) {
    fields.OwnerId = args.ownerId;
  }

  const raw = await auraAction(ctx, DESCRIPTORS.createRecord, {
    recordInput: {
      apiName: 'ContentNote',
      fields,
    },
  });

  const result = raw as RecordUiResult;

  return {
    id: result.id,
    record: flattenRecordUiFields(result),
  };
}

// ---------------------------------------------------------------------------
// GraphQL helpers for Task CRUD
// ---------------------------------------------------------------------------

async function executeGraphQL(
  ctx: AuraContext,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<GraphQLResponse> {
  const result = await auraAction(
    ctx,
    'aura://RecordUiController/ACTION$executeGraphQL',
    { queryInput: { query, variables } },
  );
  return result as GraphQLResponse;
}

// ---------------------------------------------------------------------------
// Create Task (via GraphQL mutation)
// ---------------------------------------------------------------------------

export async function createTask(
  args: CreateTaskInput,
): Promise<CreateTaskOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.subject, 'subject');

  const ctx = buildCtx(args);

  // Build the Task field assignments for the GraphQL mutation
  const fieldLines: string[] = [
    `Subject: "${args.subject.replace(/"/g, '\\"')}"`,
  ];

  if (args.status) fieldLines.push(`Status: "${args.status}"`);
  if (args.priority) fieldLines.push(`Priority: "${args.priority}"`);
  if (args.activityDate)
    fieldLines.push(`ActivityDate: "${args.activityDate}"`);
  if (args.description)
    fieldLines.push(
      `Description: "${args.description.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`,
    );
  if (args.whoId) fieldLines.push(`WhoId: "${args.whoId}"`);
  if (args.whatId) fieldLines.push(`WhatId: "${args.whatId}"`);
  if (args.ownerId) fieldLines.push(`OwnerId: "${args.ownerId}"`);
  if (args.isReminderSet != null)
    fieldLines.push(`IsReminderSet: ${args.isReminderSet}`);
  if (args.reminderDateTime)
    fieldLines.push(`ReminderDateTime: "${args.reminderDateTime}"`);

  // Merge additional fields
  if (args.fields) {
    for (const [key, value] of Object.entries(args.fields)) {
      if (typeof value === 'string') {
        fieldLines.push(`${key}: "${value.replace(/"/g, '\\"')}"`);
      } else if (typeof value === 'boolean' || typeof value === 'number') {
        fieldLines.push(`${key}: ${value}`);
      } else if (value === null) {
        fieldLines.push(`${key}: null`);
      }
    }
  }

  const query = `
    mutation CreateTask {
      uiapi {
        TaskCreate(input: { Task: { ${fieldLines.join(', ')} } }) {
          Record {
            Id
            Subject { value }
            Status { value }
            Priority { value }
            ActivityDate { value }
            Description { value }
            WhoId { value }
            WhatId { value }
            OwnerId { value }
          }
        }
      }
    }
  `;

  const response = await executeGraphQL(ctx, query);
  const record = extractGraphQLRecord(response, 'TaskCreate');

  return {
    id: record.Id,
    record,
  };
}

// ---------------------------------------------------------------------------
// Update Task (via GraphQL mutation)
// ---------------------------------------------------------------------------

export async function updateTask(
  args: UpdateTaskInput,
): Promise<UpdateTaskOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.taskId, 'taskId');

  if (!args.fields || Object.keys(args.fields).length === 0) {
    throw new Validation(
      'fields is required and must contain at least one property to update.',
    );
  }

  const ctx = buildCtx(args);

  // Build field assignments
  const fieldLines: string[] = [];
  for (const [key, value] of Object.entries(args.fields)) {
    if (typeof value === 'string') {
      fieldLines.push(
        `${key}: "${value.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`,
      );
    } else if (typeof value === 'boolean' || typeof value === 'number') {
      fieldLines.push(`${key}: ${value}`);
    } else if (value === null) {
      fieldLines.push(`${key}: null`);
    }
  }

  const query = `
    mutation UpdateTask {
      uiapi {
        TaskUpdate(input: { Task: { ${fieldLines.join(', ')} }, Id: "${args.taskId}" }) {
          Record {
            Id
            Subject { value }
            Status { value }
            Priority { value }
            ActivityDate { value }
            Description { value }
            WhoId { value }
            WhatId { value }
            OwnerId { value }
          }
        }
      }
    }
  `;

  const response = await executeGraphQL(ctx, query);
  const record = extractGraphQLRecord(response, 'TaskUpdate');

  return {
    id: record.Id,
    record,
  };
}

// ---------------------------------------------------------------------------
// Delete Task
// ---------------------------------------------------------------------------

export async function deleteTask(
  args: DeleteTaskInput,
): Promise<DeleteTaskOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.taskId, 'taskId');

  const ctx = buildCtx(args);

  // Try RecordUiController/deleteRecord first (it only needs recordId)
  // and may work even though create/update don't support Task
  try {
    await auraAction(ctx, DESCRIPTORS.deleteRecord, {
      recordId: args.taskId,
    });
  } catch (deleteErr) {
    // If RecordUiController rejects Task deletion, try GraphQL mutation
    const errMsg =
      deleteErr instanceof Error ? deleteErr.message : String(deleteErr);
    if (
      errMsg.includes('not supported in UI API') ||
      errMsg.includes('not supported')
    ) {
      const query = `
        mutation DeleteTask {
          uiapi {
            TaskDelete(input: { Id: "${args.taskId}" }) {
              Id
            }
          }
        }
      `;
      const response = await executeGraphQL(ctx, query);
      if (response.errors && response.errors.length > 0) {
        throw new UpstreamError(
          `deleteTask failed: ${response.errors.map((e) => e.message).join('; ')}`,
        );
      }
    } else {
      throw deleteErr;
    }
  }

  return {
    deleted: true,
    recordId: args.taskId,
  };
}
