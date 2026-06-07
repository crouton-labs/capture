import { z } from 'zod';
import { DscParam, CardIdParam } from '../params';

// ============================================================================
// Entity Schemas
// ============================================================================

export const CheckItemSchema = z
  .object({
    id: z.string().describe('Check item ID'),
    name: z.string().describe('Check item label/text'),
    nameData: z
      .object({ emoji: z.object({}).passthrough() })
      .passthrough()
      .describe('Parsed name data including emoji metadata'),
    state: z
      .enum(['complete', 'incomplete'])
      .describe('Check item state: "complete" or "incomplete"'),
    pos: z.number().describe('Position of the item within the checklist'),
    due: z
      .string()
      .nullable()
      .describe('Due date for this item as ISO 8601 string, or null'),
    idMember: z
      .string()
      .nullable()
      .describe('Member ID assigned to this item, or null'),
    idChecklist: z
      .string()
      .describe('ID of the checklist this item belongs to'),
    dueReminder: z
      .number()
      .nullable()
      .describe(
        'Reminder offset in minutes before the due date, or null if not set. Common values: -1 (none), 0 (at due time), 5, 10, 15, 30, 60, 120, 240, 480, 1440, 2880.',
      ),
    creationMethod: z
      .string()
      .nullable()
      .describe('Creation method identifier, or null for standard items'),
  })
  .passthrough();

export const ChecklistSchema = z
  .object({
    id: z.string().describe('Checklist ID'),
    name: z.string().describe('Checklist display name'),
    pos: z.number().describe('Position of the checklist on the card'),
    idCard: CardIdParam,
    idBoard: z.string().describe('Board ID the checklist belongs to'),
    checkItems: z
      .array(CheckItemSchema)
      .describe('All items in this checklist, ordered by position'),
  })
  .passthrough();

// ============================================================================
// Function Schemas
// ============================================================================

export const listChecklistsSchema = {
  name: 'listChecklists',
  description: 'List all checklists on a card, including their check items.',
  notes:
    'The checkItems and checkItem_fields query params are ignored by this endpoint; all check items with all fields are always returned. Use the fields param to reduce checklist-level fields in the response.',
  input: z.object({
    cardId: CardIdParam,
    fields: z
      .string()
      .optional()
      .describe(
        'Comma-separated checklist fields to include, or "all". Available fields: name, pos, idCard, idBoard, limits, creationMethod. Default response includes id, name, idBoard, idCard, pos, checkItems. Use "all" to also include limits and creationMethod.',
      ),
  }),
  output: z.object({
    checklists: z
      .array(ChecklistSchema)
      .describe('All checklists on the card, ordered by position'),
  }),
};

export type ListChecklistsInput = z.infer<typeof listChecklistsSchema.input>;
export type ListChecklistsOutput = z.infer<typeof listChecklistsSchema.output>;

export const getChecklistSchema = {
  name: 'getChecklist',
  description: 'Get a specific checklist with all its check items.',
  notes: '',
  input: z.object({
    checklistId: z.string().describe('Checklist ID (24-char hex string)'),
    checkItems: z
      .enum(['all', 'none'])
      .optional()
      .describe(
        'Whether to include check items in the response. "all" returns all items (default), "none" omits them.',
      ),
    fields: z
      .string()
      .optional()
      .describe(
        'Comma-separated list of checklist fields to return, or "all". Available fields: name, pos, idCard, idBoard, limits, creationMethod. Defaults to all standard fields when omitted.',
      ),
    checkItem_fields: z
      .string()
      .optional()
      .describe(
        'Comma-separated list of check item fields to return, or "all". Available fields: name, state, pos, due, dueReminder, idMember, idChecklist, nameData, creationMethod.',
      ),
  }),
  output: z.object({
    checklist: ChecklistSchema.describe(
      'The requested checklist with all items',
    ),
  }),
};

export type GetChecklistInput = z.infer<typeof getChecklistSchema.input>;
export type GetChecklistOutput = z.infer<typeof getChecklistSchema.output>;

export const createChecklistSchema = {
  name: 'createChecklist',
  description: 'Create a new checklist on a card.',
  notes:
    'When creating a plain checklist (no idChecklistSource), the returned checkItems array is empty. When idChecklistSource is provided, the API response includes the copied items inline; no follow-up fetch needed. Only two keepFromSource values have observable effect: "checkItems" and "all". The values "name" and "pos" are NOT supported; they behave identically to the default (copies all items from source).',
  input: z.object({
    dsc: DscParam,
    idCard: z
      .string()
      .describe(
        'Card ID (24-char hex string only, e.g. "69bdcbdd4728655d7a90a2de"). Short link slugs are NOT accepted by this endpoint; always use the full hex ID.',
      ),
    name: z
      .string()
      .optional()
      .describe(
        'Display name for the checklist. Defaults to "Checklist" if omitted. When used with keepFromSource="all", the provided name overrides the source checklist\'s name.',
      ),
    pos: z
      .union([z.enum(['top', 'bottom']), z.number()])
      .optional()
      .describe(
        'Position on the card. "top", "bottom", or a positive number. Defaults to "bottom".',
      ),
    idChecklistSource: z
      .string()
      .optional()
      .describe(
        'ID of an existing checklist to copy items from. By default (no keepFromSource), all items are copied. Use keepFromSource to control what is copied.',
      ),
    keepFromSource: z
      .enum(['all', 'checkItems'])
      .optional()
      .describe(
        'Controls which fields are copied from idChecklistSource. Only meaningful when idChecklistSource is set. "checkItems" copies only the check items; the provided name and pos params take effect normally. "all" copies name, pos, and items from source; if a name param is also provided, it overrides the source name. Omitting keepFromSource is equivalent to "all" (copies everything). The values "name" and "pos" are NOT valid; they have no observable effect and should not be used.',
      ),
    idBoard: z
      .string()
      .optional()
      .describe(
        'Board ID the card belongs to. Sent by the Trello UI for validation context; the API resolves the board from the card if omitted.',
      ),
  }),
  output: z.object({
    checklist: ChecklistSchema.describe('The newly created checklist'),
  }),
};

export type CreateChecklistInput = z.infer<typeof createChecklistSchema.input>;
export type CreateChecklistOutput = z.infer<
  typeof createChecklistSchema.output
>;

export const updateChecklistSchema = {
  name: 'updateChecklist',
  description: "Update a checklist's name or position.",
  notes: '',
  input: z.object({
    dsc: DscParam,
    checklistId: z.string().describe('Checklist ID to update'),
    name: z.string().optional().describe('New display name for the checklist'),
    pos: z
      .union([z.enum(['top', 'bottom']), z.number()])
      .optional()
      .describe('New position. "top", "bottom", or a positive number.'),
  }),
  output: z.object({
    checklist: ChecklistSchema.describe('The updated checklist'),
  }),
};

export type UpdateChecklistInput = z.infer<typeof updateChecklistSchema.input>;
export type UpdateChecklistOutput = z.infer<
  typeof updateChecklistSchema.output
>;

export const deleteChecklistSchema = {
  name: 'deleteChecklist',
  description:
    'Delete a checklist from a card. All check items within it are also deleted.',
  notes: '',
  input: z.object({
    dsc: DscParam,
    checklistId: z.string().describe('Checklist ID to delete'),
  }),
  output: z.object({
    success: z
      .boolean()
      .describe('True if the checklist was deleted successfully'),
  }),
};

export type DeleteChecklistInput = z.infer<typeof deleteChecklistSchema.input>;
export type DeleteChecklistOutput = z.infer<
  typeof deleteChecklistSchema.output
>;

export const createCheckItemSchema = {
  name: 'createCheckItem',
  description: 'Add a new item to a checklist.',
  notes: '',
  input: z.object({
    dsc: DscParam,
    checklistId: z.string().describe('Checklist ID to add the item to'),
    name: z.string().describe('Label/text for the new check item'),
    pos: z
      .union([z.enum(['top', 'bottom']), z.number()])
      .optional()
      .describe(
        'Position within the checklist. "top", "bottom", or a positive number. Defaults to "bottom".',
      ),
    checked: z
      .boolean()
      .optional()
      .describe(
        'Initial checked state. true = complete, false = incomplete (default).',
      ),
    due: z
      .string()
      .optional()
      .describe(
        'Due date for the check item as ISO 8601 string (e.g. "2026-04-01T12:00:00.000Z").',
      ),
    dueReminder: z
      .number()
      .optional()
      .describe(
        'Reminder offset in minutes before the due date. Use -1 to disable reminders. Common values: -1 (none), 0 (at due time), 5, 10, 15, 30, 60, 120, 240, 480, 1440, 2880.',
      ),
    idMember: z
      .string()
      .optional()
      .describe('Member ID to assign to this check item at creation time.'),
  }),
  output: z.object({
    checkItem: CheckItemSchema.describe('The newly created check item'),
  }),
};

export type CreateCheckItemInput = z.infer<typeof createCheckItemSchema.input>;
export type CreateCheckItemOutput = z.infer<
  typeof createCheckItemSchema.output
>;

export const updateCheckItemSchema = {
  name: 'updateCheckItem',
  description:
    'Update a check item on a card. Can change name, state (complete/incomplete), position, due date, assigned member, due reminder, or move the item to a different checklist.',
  notes: '',
  input: z.object({
    dsc: DscParam,
    cardId: CardIdParam,
    checklistId: z
      .string()
      .describe('Checklist ID the item currently belongs to (used in URL)'),
    checkItemId: z.string().describe('Check item ID to update'),
    name: z.string().optional().describe('New label/text for the check item'),
    state: z
      .enum(['complete', 'incomplete'])
      .optional()
      .describe('New state: "complete" to check it, "incomplete" to uncheck'),
    pos: z
      .union([z.enum(['top', 'bottom']), z.number()])
      .optional()
      .describe('New position within the checklist'),
    due: z
      .string()
      .nullable()
      .optional()
      .describe(
        'Due date as ISO 8601 string (e.g. "2026-04-01T12:00:00.000Z"), or null or empty string "" to clear the due date.',
      ),
    idMember: z
      .string()
      .nullable()
      .optional()
      .describe(
        'Member ID to assign to this check item, or null or empty string "" to unassign the current member.',
      ),
    dueReminder: z
      .number()
      .optional()
      .describe(
        'Reminder offset in minutes before the due date. Use -1 to disable reminders. Common values: -1 (none), 0 (at due time), 5, 10, 15, 30, 60, 120, 240, 480, 1440, 2880.',
      ),
    idChecklist: z
      .string()
      .optional()
      .describe(
        'Move the check item to a different checklist by providing the target checklist ID. The item is removed from its current checklist and added to the target.',
      ),
  }),
  output: z.object({
    checkItem: CheckItemSchema.describe('The updated check item'),
  }),
};

export type UpdateCheckItemInput = z.infer<typeof updateCheckItemSchema.input>;
export type UpdateCheckItemOutput = z.infer<
  typeof updateCheckItemSchema.output
>;

export const deleteCheckItemSchema = {
  name: 'deleteCheckItem',
  description: 'Delete an item from a checklist.',
  notes: '',
  input: z.object({
    dsc: DscParam,
    checklistId: z.string().describe('Checklist ID the item belongs to'),
    checkItemId: z.string().describe('Check item ID to delete'),
  }),
  output: z.object({
    success: z
      .boolean()
      .describe('True if the check item was deleted successfully'),
  }),
};

export type DeleteCheckItemInput = z.infer<typeof deleteCheckItemSchema.input>;
export type DeleteCheckItemOutput = z.infer<
  typeof deleteCheckItemSchema.output
>;

// ============================================================================
// Domain Schema Array
// ============================================================================

export const checklistsSchemas = [
  listChecklistsSchema,
  getChecklistSchema,
  createChecklistSchema,
  updateChecklistSchema,
  deleteChecklistSchema,
  createCheckItemSchema,
  updateCheckItemSchema,
  deleteCheckItemSchema,
];
