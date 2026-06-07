import { z } from 'zod';

const SlugParam = z.string().describe('Workspace slug from getContext()');

export const TaskSchema = z.object({
  taskId: z.string().describe('Task UUID'),
  title: z.string().describe('Task title'),
  deadlineAt: z.string().nullable().optional().describe('Deadline ISO string'),
  visibility: z
    .enum(['public', 'private'])
    .describe(
      'Task visibility. "public" = visible to all workspace members; "private" = visible to creator only.',
    ),
  createdAt: z.string().describe('ISO creation timestamp'),
  createdBy: z.string().describe('Creator user UUID'),
  completedAt: z
    .string()
    .nullable()
    .optional()
    .describe('ISO completion timestamp, null if not yet complete'),
  assignees: z.array(z.string()).optional().describe('Assigned user UUIDs'),
});

export const listTasksSchema = {
  name: 'listTasks',
  description:
    'List tasks in the workspace, optionally filtered by assignee or completion status',
  notes:
    'Requires getContext() first to obtain taskEntityDefId. Look up entityDefinitions by the slug for your tasks object (often "tasks"; verify in workspace).',
  input: z.object({
    slug: SlugParam,
    taskEntityDefId: z
      .string()
      .describe(
        'Task entity definition UUID from getContext(); look for the entity with name "Task"',
      ),
    assigneeId: z
      .string()
      .optional()
      .describe('Filter to tasks assigned to this user UUID'),
    completed: z
      .boolean()
      .optional()
      .describe(
        'Filter by completion status: true = completed only, false = incomplete only, omit = all tasks',
      ),
  }),
  output: z.object({
    tasks: z.array(TaskSchema).describe('Task records'),
  }),
};

export const getTaskSchema = {
  name: 'getTask',
  description: 'Get full details for a single task by UUID',
  notes: 'Obtain taskId from listTasks().',
  input: z.object({
    slug: SlugParam,
    taskId: z.string().describe('Task UUID'),
  }),
  output: TaskSchema,
};

export const createTaskSchema = {
  name: 'createTask',
  description: 'Create a standalone task in the workspace',
  notes:
    'Tasks are created standalone; record linking via linked_records is not supported. Tasks default to "public" visibility.',
  input: z.object({
    slug: SlugParam,
    title: z.string().describe('Task title'),
    deadlineAt: z
      .string()
      .optional()
      .describe('Deadline as ISO 8601 string (e.g. 2024-12-31T17:00:00Z)'),
    assigneeId: z
      .string()
      .optional()
      .describe('User UUID to assign the task to. Obtain from listUsers().'),
  }),
  output: z.object({
    taskId: z.string().describe('Task UUID'),
    title: z.string().describe('Task title'),
    deadlineAt: z
      .string()
      .nullable()
      .optional()
      .describe('Deadline ISO string'),
    visibility: z
      .enum(['public', 'private'])
      .describe('Task visibility (public or private)'),
    createdAt: z.string().describe('ISO creation timestamp'),
    createdBy: z.string().describe('Creator user UUID'),
  }),
};

export const updateTaskSchema = {
  name: 'updateTask',
  description:
    'Update a task: change title, assignee, deadline, or mark complete/incomplete',
  notes:
    'To mark complete, set completedAt to the current ISO timestamp. To unmark, set completedAt to null. To unassign, set assigneeId to null. Obtain taskId from listTasks().',
  input: z.object({
    slug: SlugParam,
    taskId: z.string().describe('Task UUID'),
    title: z.string().optional().describe('New task title'),
    deadlineAt: z
      .string()
      .nullable()
      .optional()
      .describe('New deadline ISO string, or null to remove deadline'),
    completedAt: z
      .string()
      .nullable()
      .optional()
      .describe('ISO timestamp to mark complete, or null to mark incomplete'),
    assigneeId: z
      .string()
      .nullable()
      .optional()
      .describe('User UUID to assign the task to, or null to unassign'),
  }),
  output: TaskSchema,
};

export const deleteTaskSchema = {
  name: 'deleteTask',
  description: 'Permanently delete a task by UUID',
  notes: 'Obtain taskId from listTasks(). This operation is irreversible.',
  input: z.object({
    slug: SlugParam,
    taskId: z.string().describe('Task UUID'),
  }),
  output: z.object({
    success: z.boolean().describe('True if deleted successfully'),
  }),
};

export type Task = z.infer<typeof TaskSchema>;
export type CreateTaskOutput = z.infer<typeof createTaskSchema.output>;
export type ListTasksOutput = z.infer<typeof listTasksSchema.output>;
export type GetTaskOutput = z.infer<typeof getTaskSchema.output>;
export type UpdateTaskOutput = z.infer<typeof updateTaskSchema.output>;
export type DeleteTaskOutput = z.infer<typeof deleteTaskSchema.output>;
