import { z } from 'zod';
import { DscParam, BoardIdParam, ListIdParam, ListSchema } from '../params';

// ============================================================================
// Function Schemas
// ============================================================================

export const listListsSchema = {
  name: 'listLists',
  description: 'List all lists (columns) on a board.',
  notes: '',
  input: z.object({
    boardId: BoardIdParam,
    filter: z
      .enum(['open', 'closed', 'all'])
      .optional()
      .describe('Filter lists by status. Defaults to "open".'),
    fields: z
      .string()
      .optional()
      .describe(
        'Comma-separated list fields to return, or "all" for all fields, or "none" for only id. Available fields: id, name, closed, color, idBoard, pos, subscribed, softLimit, type, datasource.',
      ),
    cards: z
      .enum(['none', 'open', 'closed', 'all'])
      .optional()
      .describe(
        'Embed cards into each list. Omit to return lists without cards.',
      ),
    card_fields: z
      .string()
      .optional()
      .describe(
        'Comma-separated card fields to include when cards is specified (e.g. "id,name,desc,due"). Use "all" for all card fields.',
      ),
  }),
  output: z.object({
    lists: z
      .array(ListSchema)
      .describe('Lists on the board, sorted by position'),
  }),
};

export type ListListsInput = z.infer<typeof listListsSchema.input>;
export type ListListsOutput = z.infer<typeof listListsSchema.output>;

export const getListSchema = {
  name: 'getList',
  description: 'Get details for a single list by ID.',
  notes: '',
  input: z.object({
    listId: ListIdParam,
    fields: z
      .string()
      .optional()
      .describe(
        'Comma-separated list fields to return, or "all" for all fields. Available: id, name, closed, color, idBoard, pos, subscribed, softLimit, type, datasource.',
      ),
    board: z
      .boolean()
      .optional()
      .describe(
        'When true, embeds the parent board object inside the returned list.',
      ),
    board_fields: z
      .string()
      .optional()
      .describe(
        'Comma-separated board fields to include when board=true (e.g. "id,name,shortLink").',
      ),
    cards: z
      .enum(['none', 'open', 'closed', 'all'])
      .optional()
      .describe(
        'Embed cards into the returned list. "open" returns non-archived cards, "closed" archived ones, "all" both.',
      ),
    card_fields: z
      .string()
      .optional()
      .describe(
        'Comma-separated card fields to include when cards is specified (e.g. "id,name,desc,due").',
      ),
  }),
  output: z.object({
    list: ListSchema.describe('The requested list'),
  }),
};

export type GetListInput = z.infer<typeof getListSchema.input>;
export type GetListOutput = z.infer<typeof getListSchema.output>;

export const createListSchema = {
  name: 'createList',
  description: 'Create a new list (column) on a board.',
  notes: '',
  input: z.object({
    dsc: DscParam,
    idBoard: BoardIdParam,
    name: z.string().describe('List display name'),
    pos: z
      .union([z.enum(['top', 'bottom']), z.number()])
      .optional()
      .describe(
        'Position on the board. "top", "bottom", or a positive float. Defaults to "bottom".',
      ),
    color: z
      .enum(['yellow', 'purple', 'blue', 'red', 'green', 'orange', 'lime'])
      .optional()
      .describe('Color label for the list header. Omit for no color.'),
    idListSource: z
      .string()
      .optional()
      .describe('ID of an existing list to copy cards from into the new list.'),
  }),
  output: z.object({
    list: ListSchema.describe('The newly created list'),
  }),
};

export type CreateListInput = z.infer<typeof createListSchema.input>;
export type CreateListOutput = z.infer<typeof createListSchema.output>;

export const updateListSchema = {
  name: 'updateList',
  description:
    "Update a list's name, position, color, subscription, card limit, or archive state.",
  notes: '',
  input: z.object({
    dsc: DscParam,
    listId: ListIdParam,
    name: z.string().optional().describe('New list display name'),
    pos: z
      .union([z.enum(['top', 'bottom']), z.number()])
      .optional()
      .describe('New position. "top", "bottom", or a positive float.'),
    color: z
      .enum(['yellow', 'purple', 'blue', 'red', 'green', 'orange', 'lime'])
      .optional()
      .describe('Color label for the list header.'),
    subscribed: z
      .boolean()
      .optional()
      .describe(
        'Whether the current member is subscribed to this list for notifications.',
      ),
    softLimit: z
      .number()
      .optional()
      .describe(
        'Card limit (WIP limit) for the list. Set to 0 to clear the limit.',
      ),
    closed: z
      .boolean()
      .optional()
      .describe('Archive (true) or unarchive (false) the list.'),
  }),
  output: z.object({
    list: ListSchema.describe('The updated list'),
  }),
};

export type UpdateListInput = z.infer<typeof updateListSchema.input>;
export type UpdateListOutput = z.infer<typeof updateListSchema.output>;

export const archiveListSchema = {
  name: 'archiveList',
  description:
    'Archive or unarchive a list. When archiving, cards in the list are hidden but not deleted and can be recovered by unarchiving.',
  notes: '',
  input: z.object({
    dsc: DscParam,
    listId: ListIdParam,
    value: z
      .boolean()
      .optional()
      .describe(
        'true to archive (close) the list, false to unarchive (reopen) it. Defaults to true.',
      ),
  }),
  output: z.object({
    list: ListSchema.describe('The updated list with new closed state'),
  }),
};

export type ArchiveListInput = z.infer<typeof archiveListSchema.input>;
export type ArchiveListOutput = z.infer<typeof archiveListSchema.output>;

export const moveListSchema = {
  name: 'moveList',
  description: 'Move a list to a different board.',
  notes: '',
  input: z.object({
    dsc: DscParam,
    listId: ListIdParam,
    targetBoardId: BoardIdParam.describe('ID of the destination board'),
    pos: z
      .union([z.enum(['top', 'bottom']), z.number()])
      .optional()
      .describe(
        'Position on the target board after moving. "top", "bottom", or a positive float. Defaults to bottom of the target board.',
      ),
  }),
  output: z.object({
    list: ListSchema.describe('The moved list, now on the target board'),
  }),
};

export type MoveListInput = z.infer<typeof moveListSchema.input>;
export type MoveListOutput = z.infer<typeof moveListSchema.output>;

// ============================================================================
// Domain Schema Array
// ============================================================================

export const listsSchemas = [
  listListsSchema,
  getListSchema,
  createListSchema,
  updateListSchema,
  archiveListSchema,
  moveListSchema,
];
