import { z } from 'zod';
import {
  DscParam,
  BoardIdParam,
  ListIdParam,
  CardIdParam,
  MemberIdParam,
  LabelIdParam,
  CardLabelSchema,
  CardSchema,
  CardMemberSchema,
  AttachmentSchema,
} from '../params';

// ============================================================================
// Nested Entity Schemas (for getCard)
// ============================================================================

const EmbeddedChecklistItemSchema = z.object({
  id: z.string().describe('Checklist item ID'),
  name: z.string().describe('Checklist item text'),
  state: z
    .enum(['incomplete', 'complete'])
    .describe('Item completion state: "incomplete" or "complete"'),
  pos: z
    .number()
    .describe('Item position within the checklist (lower = higher)'),
  due: z
    .string()
    .nullable()
    .describe('Due date for this item as ISO 8601, or null'),
  idMember: z
    .string()
    .nullable()
    .describe('Member ID assigned to this item, or null'),
});

const EmbeddedChecklistSchema = z.object({
  id: z.string().describe('Checklist ID'),
  name: z.string().describe('Checklist display name'),
  pos: z.number().describe('Checklist position on the card (lower = higher)'),
  idCard: CardIdParam,
  checkItems: z
    .array(EmbeddedChecklistItemSchema)
    .describe('Items in this checklist, ordered by position'),
});

const CardActionSchema = z.object({
  id: z
    .string()
    .describe('Action ID (used as cursor for pagination via before=)'),
  type: z
    .string()
    .describe(
      'Action type (e.g. "commentCard", "updateCard", "createCard", "addMemberToCard")',
    ),
  date: z.string().describe('Action timestamp as ISO 8601 string'),
  data: z
    .record(z.string(), z.unknown())
    .describe(
      'Action-specific payload. Common keys: text (comments), card, list, board',
    ),
  memberCreator: z
    .object({
      id: z.string(),
      username: z.string(),
      fullName: z.string(),
      initials: z.string(),
      avatarUrl: z.string().nullable(),
    })
    .describe('Member who performed the action'),
});

const CardStickerSchema = z.object({
  id: z.string().describe('Sticker ID'),
  image: z.string().describe('Sticker image name'),
  imageUrl: z.string().describe('URL of the sticker image'),
  left: z
    .number()
    .describe('Horizontal position as a percentage (0–100) from the left'),
  top: z
    .number()
    .describe('Vertical position as a percentage (0–100) from the top'),
  rotate: z.number().describe('Rotation angle in degrees'),
  zIndex: z.number().describe('Stack order (higher = in front)'),
});

const CardPluginDataSchema = z.object({
  id: z.string().describe('Plugin data record ID'),
  idPlugin: z.string().describe('Plugin ID'),
  scope: z.string().describe('Data scope (card, board, member, etc.)'),
  idModel: z.string().describe('ID of the model this data is attached to'),
  value: z
    .string()
    .describe('Plugin-specific value (usually a JSON-encoded string)'),
});

export const FullCardSchema = CardSchema.extend({
  start: z
    .string()
    .nullable()
    .describe('Start date as ISO 8601 string, or null'),
  checklists: z
    .array(EmbeddedChecklistSchema)
    .describe('Checklists attached to this card'),
  attachments: z
    .array(AttachmentSchema)
    .describe('File and URL attachments on this card'),
  members: z
    .array(CardMemberSchema)
    .describe('Full member objects currently assigned to this card'),
  actions: z
    .array(CardActionSchema)
    .optional()
    .describe(
      'Embedded card actions. Present only when the actions input param is provided (e.g. actions="commentCard,updateCard").',
    ),
  pluginData: z
    .array(CardPluginDataSchema)
    .optional()
    .describe(
      'Embedded plugin data records. Present only when pluginData=true is passed.',
    ),
  stickers: z
    .array(CardStickerSchema)
    .optional()
    .describe(
      'Stickers placed on the card. Present only when stickers=true is passed.',
    ),
});

// ============================================================================
// Function Schemas
// ============================================================================

export const createCardSchema = {
  name: 'createCard',
  description: 'Create a new card in a list.',
  notes: '',
  input: z.object({
    dsc: DscParam,
    idList: ListIdParam,
    name: z.string().describe('Card title'),
    desc: z.string().optional().describe('Card description (Markdown)'),
    due: z
      .string()
      .optional()
      .describe(
        'Due date as ISO 8601 string (e.g. "2026-03-25T17:00:00.000Z")',
      ),
    dueComplete: z
      .boolean()
      .optional()
      .describe('Set the due date as already complete at creation time'),
    dueReminder: z
      .number()
      .optional()
      .describe(
        'Minutes before the due date to send a reminder. Use -1 to disable. Common values: 1, 2, 5, 10, 15, 30, 60, 120, 240, 480, 1440, 2880.',
      ),
    start: z.string().optional().describe('Start date as ISO 8601 string'),
    idMembers: z
      .array(z.string())
      .optional()
      .describe('Array of member IDs to assign to the card'),
    idLabels: z
      .array(z.string())
      .optional()
      .describe('Array of label IDs to apply to the card'),
    pos: z
      .union([z.enum(['top', 'bottom']), z.number()])
      .optional()
      .describe(
        'Position in the list. "top", "bottom", or a positive number. Defaults to "bottom".',
      ),
    idCardSource: z
      .string()
      .optional()
      .describe(
        'ID of a card to copy. When set, the new card is a copy of the source card.',
      ),
    keepFromSource: z
      .union([
        z.enum(['all']),
        z.array(
          z.enum([
            'checklists',
            'attachments',
            'comments',
            'due',
            'stickers',
            'customFields',
          ]),
        ),
      ])
      .optional()
      .describe(
        'What to copy from the source card when idCardSource is provided. Use "all" to copy everything, or an array of specific fields: "checklists", "attachments", "comments", "due", "stickers", "customFields".',
      ),
    urlSource: z
      .string()
      .optional()
      .describe(
        'A URL to attach to the card as an attachment at creation time',
      ),
    subscribed: z
      .boolean()
      .optional()
      .describe(
        'Subscribe the current member to the card at creation. Defaults to false.',
      ),
    address: z
      .string()
      .optional()
      .describe('Physical address for a location card'),
    locationName: z
      .string()
      .optional()
      .describe('Display name for the location on a location card'),
    coordinates: z
      .string()
      .optional()
      .describe(
        'Latitude and longitude as a comma-separated string (e.g. "44.0000,-93.0000") for a location card',
      ),
  }),
  output: z.object({
    card: CardSchema.extend({
      start: z
        .string()
        .nullable()
        .describe('Start date as ISO 8601 string, or null if not set'),
      dueReminder: z
        .number()
        .nullable()
        .describe(
          'Minutes before the due date to send a reminder. -1 means disabled. Null if not set.',
        ),
    }).describe('The newly created card'),
  }),
};

export type CreateCardInput = z.infer<typeof createCardSchema.input>;
export type CreateCardOutput = z.infer<typeof createCardSchema.output>;

export const deleteCardSchema = {
  name: 'deleteCard',
  description:
    'Permanently delete a card. This action is irreversible; the card cannot be recovered.',
  notes:
    'Use archiveCard (updateCard with closed=true) if you want a recoverable operation.',
  input: z.object({
    dsc: DscParam,
    cardId: CardIdParam,
  }),
  output: z.object({
    success: z.boolean().describe('True if the card was deleted successfully'),
  }),
};

export type DeleteCardInput = z.infer<typeof deleteCardSchema.input>;
export type DeleteCardOutput = z.infer<typeof deleteCardSchema.output>;

export const listCardsSchema = {
  name: 'listCards',
  description:
    'List cards on a board or a specific list. Provide boardId OR listId; at least one is required.',
  notes: '',
  input: z.object({
    boardId: BoardIdParam.optional().describe(
      'Board ID: returns all cards across the board. Provide this or listId.',
    ),
    listId: ListIdParam.optional().describe(
      'List ID: returns cards in this specific list only. Provide this or boardId.',
    ),
    filter: z
      .enum(['open', 'closed', 'all', 'visible'])
      .optional()
      .describe(
        'Filter cards by status. Defaults to "open". "visible" includes cards on non-archived lists. Applies when using boardId; also accepted on listId endpoint.',
      ),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        'Maximum number of cards to return. Applies to both boardId and listId queries. Defaults to all cards.',
      ),
  }),
  output: z.object({
    cards: z.array(CardSchema).describe('Cards matching the query'),
  }),
};

export type ListCardsInput = z.infer<typeof listCardsSchema.input>;
export type ListCardsOutput = z.infer<typeof listCardsSchema.output>;

export const getCardSchema = {
  name: 'getCard',
  description:
    'Get full details for a card including checklists, attachments, and assigned members.',
  notes: '',
  input: z.object({
    cardId: CardIdParam,
    fields: z
      .string()
      .optional()
      .describe(
        'Comma-separated list of card fields to include in the response. When omitted, all standard fields are returned. E.g. "id,name,desc,due,idList".',
      ),
    actions: z
      .string()
      .optional()
      .describe(
        'Comma-separated list of action types to embed in the response (e.g. "commentCard,updateCard,createCard"). When provided, the card object includes an actions array.',
      ),
    actions_limit: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        'Maximum number of actions to return when actions param is provided. Defaults to 50.',
      ),
    actions_display: z
      .boolean()
      .optional()
      .describe(
        'When true, actions are formatted for display (resolves member names, etc.). Requires actions param to be set.',
      ),
    action_reactions: z
      .boolean()
      .optional()
      .describe(
        'When true, includes emoji reactions on each action object. Requires actions param to be set.',
      ),
    attachment_fields: z
      .string()
      .optional()
      .describe(
        'Comma-separated list of attachment fields to include. Defaults to all fields. E.g. "id,name,url,mimeType,bytes,date,isUpload,edgeColor".',
      ),
    pluginData: z
      .boolean()
      .optional()
      .describe(
        'When true, includes plugin/Power-Up data records attached to the card.',
      ),
    stickers: z
      .boolean()
      .optional()
      .describe('When true, includes sticker objects placed on the card.'),
    sticker_fields: z
      .string()
      .optional()
      .describe(
        'Comma-separated list of sticker fields to include. Defaults to all fields. Requires stickers=true.',
      ),
    checklist_fields: z
      .string()
      .optional()
      .describe(
        'Comma-separated list of checklist fields to include. Defaults to all fields. E.g. "id,name,pos".',
      ),
    checklist_checkItems: z
      .enum(['all', 'none'])
      .optional()
      .describe(
        'Controls whether check items are included in each checklist. "all" returns check items; "none" returns checklists without items. Defaults to "all".',
      ),
    member_fields: z
      .string()
      .optional()
      .describe(
        'Comma-separated list of member fields to include for assigned members. Defaults to all fields. E.g. "id,fullName,username,avatarUrl,initials".',
      ),
  }),
  output: z.object({
    card: FullCardSchema.describe(
      'Full card with embedded checklists, attachments, and member objects',
    ),
  }),
};

export type GetCardInput = z.infer<typeof getCardSchema.input>;
export type GetCardOutput = z.infer<typeof getCardSchema.output>;

export const updateCardSchema = {
  name: 'updateCard',
  description:
    'Update one or more fields on a card. Only the fields you provide are changed.',
  notes: '',
  input: z.object({
    dsc: DscParam,
    cardId: CardIdParam,
    name: z.string().optional().describe('New card title'),
    desc: z.string().optional().describe('New description (Markdown)'),
    due: z
      .string()
      .optional()
      .describe(
        'Due date as ISO 8601 string. Pass empty string "" to clear the due date.',
      ),
    dueComplete: z
      .boolean()
      .optional()
      .describe('Mark the due date complete (true) or incomplete (false)'),
    dueReminder: z
      .number()
      .nullable()
      .optional()
      .describe(
        'Minutes before the due date to send a reminder. Use -1 to disable. Common values: 1, 2, 5, 10, 15, 30, 60, 120, 240, 480, 1440, 2880. null to clear.',
      ),
    start: z
      .string()
      .optional()
      .describe(
        'Start date as ISO 8601 string. Pass empty string "" to clear the start date.',
      ),
    closed: z
      .boolean()
      .optional()
      .describe('Set to true to archive the card, false to unarchive'),
    idList: ListIdParam.optional().describe('Move card to this list ID'),
    idMembers: z
      .array(z.string())
      .optional()
      .describe(
        'Full list of member IDs to assign to the card. Replaces all existing member assignments.',
      ),
    idLabels: z
      .array(z.string())
      .optional()
      .describe(
        'Full list of label IDs to apply to the card. Replaces all existing labels. Pass an empty array to remove all labels.',
      ),
    pos: z
      .union([z.enum(['top', 'bottom']), z.number()])
      .optional()
      .describe(
        'New position within the list. "top", "bottom", or a positive float.',
      ),
    subscribed: z
      .boolean()
      .optional()
      .describe(
        'Subscribe (true) or unsubscribe (false) the current member from the card.',
      ),
    cover: z
      .object({
        color: z
          .enum([
            'pink',
            'yellow',
            'lime',
            'blue',
            'black',
            'orange',
            'red',
            'purple',
            'sky',
            'green',
          ])
          .nullable()
          .optional()
          .describe('Cover background color. null to remove color.'),
        size: z
          .enum(['normal', 'full'])
          .optional()
          .describe(
            'Cover display size. "normal" shows a small banner; "full" fills the card face.',
          ),
        brightness: z
          .enum(['light', 'dark'])
          .optional()
          .describe(
            'Text/icon contrast on the cover. "light" for light text on dark backgrounds; "dark" for dark text on light backgrounds.',
          ),
      })
      .optional()
      .describe(
        'Card cover settings. Provide an object with color/size/brightness to set or update the cover.',
      ),
    isTemplate: z
      .boolean()
      .optional()
      .describe(
        'Mark the card as a template (true) or a regular card (false).',
      ),
    address: z
      .string()
      .optional()
      .describe('Physical address for a location card.'),
    locationName: z
      .string()
      .optional()
      .describe('Display name for the location on a location card.'),
    coordinates: z
      .string()
      .optional()
      .describe(
        'Latitude and longitude as a comma-separated string (e.g. "44.0000,-93.0000") for a location card.',
      ),
  }),
  output: z.object({
    card: CardSchema.extend({
      start: z
        .string()
        .nullable()
        .describe('Start date as ISO 8601 string, or null if not set'),
    }).describe('The card after applying updates'),
  }),
};

export type UpdateCardInput = z.infer<typeof updateCardSchema.input>;
export type UpdateCardOutput = z.infer<typeof updateCardSchema.output>;

export const moveCardSchema = {
  name: 'moveCard',
  description:
    'Move a card to a different list, optionally on a different board.',
  notes:
    'For cross-board moves, provide both idList and idBoard. The target list must belong to the target board.',
  input: z.object({
    dsc: DscParam,
    cardId: CardIdParam,
    idList: ListIdParam.describe('Target list ID to move the card into'),
    idBoard: BoardIdParam.optional().describe(
      'Target board ID (required when moving to a different board)',
    ),
    pos: z
      .union([z.enum(['top', 'bottom']), z.number()])
      .optional()
      .describe(
        'Position of the card in the target list after moving. "top", "bottom", or a non-negative float. Defaults to placing the card at the bottom.',
      ),
  }),
  output: z.object({
    card: CardSchema.describe('The card after moving'),
  }),
};

export type MoveCardInput = z.infer<typeof moveCardSchema.input>;
export type MoveCardOutput = z.infer<typeof moveCardSchema.output>;

export const archiveCardSchema = {
  name: 'archiveCard',
  description:
    'Archive a card. Archived cards are hidden from the board but recoverable.',
  notes:
    'Archived cards can be retrieved with listCards using filter="closed". Use deleteCard for permanent removal.',
  input: z.object({
    dsc: DscParam,
    cardId: CardIdParam,
  }),
  output: z.object({
    card: CardSchema.describe('The archived card (closed: true)'),
  }),
};

export type ArchiveCardInput = z.infer<typeof archiveCardSchema.input>;
export type ArchiveCardOutput = z.infer<typeof archiveCardSchema.output>;

const MemberCardLabelSchema = z.object({
  id: LabelIdParam,
  idBoard: BoardIdParam,
  idOrganization: z
    .string()
    .describe('Organization/workspace ID the label belongs to'),
  name: z.string().describe('Label display name'),
  color: z.string().nullable().describe('Label color'),
  uses: z.number().describe('Number of cards using this label'),
});

const MemberCardSchema = z.object({
  id: CardIdParam,
  name: z.string().describe('Card title'),
  idList: ListIdParam,
  idBoard: BoardIdParam,
  idMembers: z.array(z.string()).describe('Member IDs assigned to this card'),
  labels: z
    .array(MemberCardLabelSchema)
    .describe('Labels applied to this card'),
  due: z.string().nullable().describe('Due date as ISO 8601 string, or null'),
  dueComplete: z.boolean().describe('Whether the due date is marked complete'),
  dueReminder: z
    .number()
    .nullable()
    .describe(
      'Minutes before due date to send a reminder. -1 means disabled. null if no reminder is set.',
    ),
  start: z
    .string()
    .nullable()
    .describe('Start date as ISO 8601 string, or null'),
  url: z.string().describe('Full card URL'),
  shortUrl: z
    .string()
    .describe('Short card URL (e.g. "https://trello.com/c/0LjYXtFD")'),
  cardRole: z
    .string()
    .nullable()
    .describe('Card role, or null for standard cards'),
  isTemplate: z.boolean().describe('Whether this card is a template'),
  dateLastActivity: z
    .string()
    .describe('ISO 8601 timestamp of the last activity on this card'),
});

export const listCardsForMemberSchema = {
  name: 'listCardsForMember',
  description:
    'Get all cards assigned to a specific member. Returns up to 500 cards.',
  notes:
    'This endpoint returns a condensed card shape: no desc, pos, closed, badges, or shortLink. Use getCard for full card details.',
  input: z.object({
    memberId: MemberIdParam.optional().describe(
      'Member ID, or the string "me" for the current user. Defaults to "me".',
    ),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Maximum number of cards to return. Defaults to 500.'),
    sort: z
      .enum(['due', 'board'])
      .optional()
      .describe(
        'Sort order for the returned cards. "due" sorts ascending by due date (null dues appear last). "board" groups cards by board. Defaults to "due".',
      ),
    dueComplete: z
      .boolean()
      .optional()
      .describe(
        'Filter by due date completion status. true returns only cards whose due date is marked complete; false returns only incomplete. Omit to return all cards regardless of due date completion.',
      ),
  }),
  output: z.object({
    cards: z.array(MemberCardSchema).describe('Cards assigned to the member'),
  }),
};

export type ListCardsForMemberInput = z.infer<
  typeof listCardsForMemberSchema.input
>;
export type ListCardsForMemberOutput = z.infer<
  typeof listCardsForMemberSchema.output
>;

// ============================================================================
// Domain Schema Array
// ============================================================================

export const cardsSchemas = [
  createCardSchema,
  deleteCardSchema,
  listCardsSchema,
  getCardSchema,
  updateCardSchema,
  moveCardSchema,
  archiveCardSchema,
  listCardsForMemberSchema,
];

// Re-export CardLabelSchema for use in index.ts mappers
export { CardLabelSchema };
