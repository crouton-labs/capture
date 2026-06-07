import { z } from 'zod';
import {
  DscParam,
  BoardIdParam,
  CardIdParam,
  MemberIdParam,
  ListIdParam,
  AttachmentSchema,
} from '../params';

// ============================================================================
// Entity Schemas
// ============================================================================

export const ActionMemberCreatorSchema = z.object({
  id: MemberIdParam,
  username: z.string().describe('Member username'),
  fullName: z.string().describe('Member display name'),
  initials: z.string().describe('Member initials'),
  avatarUrl: z
    .string()
    .nullable()
    .describe('Avatar image URL, or null if not set'),
});

export const ActionSchema = z.object({
  id: z
    .string()
    .describe('Action ID (used as cursor for pagination via before=)'),
  type: z
    .string()
    .describe(
      'Action type (e.g. "commentCard", "updateCard", "createCard", "moveCardToBoard", "addMemberToCard")',
    ),
  date: z.string().describe('Action timestamp as ISO 8601 string'),
  data: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      'Action-specific data payload. Common keys: text (comments), card (card info), list (list info), board (board info). Absent when fields= param omits "data".',
    ),
  memberCreator: ActionMemberCreatorSchema.optional().describe(
    'Member who performed the action. Absent when memberCreator=false is passed.',
  ),
  entities: z
    .array(z.record(z.string(), z.unknown()))
    .optional()
    .describe(
      'Structured entities summary for the action. Present only when entities=true is passed. Each entry describes a named entity (card, board, list, member) referenced in the action.',
    ),
  reactions: z
    .array(z.record(z.string(), z.unknown()))
    .optional()
    .describe(
      'Emoji reactions on the action. Present only when reactions=true is passed.',
    ),
  display: z
    .object({
      translationKey: z
        .string()
        .describe(
          'i18n translation key for the action (e.g. "action_remove_checklist_from_card")',
        ),
      entities: z
        .record(z.string(), z.unknown())
        .describe(
          'Named entities referenced in the action (card, board, list, member, checklist, etc.). Each entry has type, id, text, and entity-specific fields.',
        ),
    })
    .optional()
    .describe(
      'Human-readable display data. Present only when display=true is passed. Contains translationKey for i18n and entities with named objects.',
    ),
});

export const CustomFieldOptionSchema = z.object({
  id: z.string().describe('Option ID (used as idValue when setting the field)'),
  idCustomField: z
    .string()
    .describe('ID of the custom field this option belongs to'),
  value: z
    .object({ text: z.string().describe('Option display text') })
    .describe('Option value'),
  color: z
    .string()
    .nullable()
    .describe(
      'Option color label (e.g. "green", "blue"), or "none" when no color is set',
    ),
  pos: z.number().describe('Option position in the dropdown list'),
});

export const CustomFieldSchema = z.object({
  id: z.string().describe('Custom field definition ID'),
  name: z.string().describe('Custom field display name'),
  type: z
    .enum(['text', 'number', 'date', 'checkbox', 'list'])
    .describe(
      'Field type: determines the shape of value in setCustomFieldValue',
    ),
  pos: z.number().describe('Field position on the board'),
  idModel: z
    .string()
    .optional()
    .describe('ID of the board this custom field belongs to'),
  modelType: z
    .string()
    .optional()
    .describe('Model type: always "board" for board-level custom fields'),
  fieldGroup: z
    .string()
    .optional()
    .describe(
      'Unique identifier hash grouping related custom fields across boards',
    ),
  display: z
    .object({
      cardFront: z
        .boolean()
        .describe(
          'Whether this field is shown on the card front (visible without opening the card)',
        ),
    })
    .passthrough()
    .optional()
    .describe('Display settings for the custom field'),
  isSuggestedField: z
    .boolean()
    .optional()
    .describe(
      'Whether this field was added from a Trello-suggested template (e.g. Priority, Status, Risk)',
    ),
  options: z
    .array(CustomFieldOptionSchema)
    .optional()
    .describe('Available options for list-type fields; absent for other types'),
});

export const BulkResultSchema = z.object({
  succeeded: z
    .array(z.string())
    .describe('IDs of cards that were successfully processed'),
  failed: z
    .array(
      z.object({
        id: z.string().describe('Card ID that failed'),
        error: z
          .string()
          .describe('Error message describing why the operation failed'),
      }),
    )
    .describe('Cards that failed with their error messages'),
});

export const SearchCardSchema = z.object({
  id: CardIdParam,
  name: z.string().describe('Card title'),
  idBoard: BoardIdParam,
  idList: ListIdParam,
  shortLink: z.string().describe('Short URL identifier'),
  url: z.string().describe('Full card URL'),
  desc: z.string().describe('Card description'),
  due: z.string().nullable().describe('Due date as ISO 8601 string, or null'),
  closed: z.boolean().describe('Whether the card is archived'),
  board: z
    .object({
      id: BoardIdParam,
      name: z.string().describe('Board display name'),
      url: z.string().describe('Full board URL'),
    })
    .optional()
    .describe(
      'Embedded board data. Present only when cardBoard: true is passed.',
    ),
  list: z
    .object({
      id: ListIdParam,
      name: z.string().describe('List name'),
      closed: z.boolean().describe('Whether the list is archived'),
      color: z
        .string()
        .nullable()
        .describe('List color label, or null if none'),
      idBoard: BoardIdParam,
      pos: z.number().describe('List position on the board'),
      subscribed: z
        .boolean()
        .describe('Whether the current user is subscribed to the list'),
      softLimit: z
        .number()
        .nullable()
        .describe('Soft card limit for the list, or null'),
      type: z
        .string()
        .nullable()
        .describe('List type, or null for standard lists'),
    })
    .optional()
    .describe(
      'Embedded list data. Present only when cardList: true is passed.',
    ),
});

export const SearchBoardSchema = z.object({
  id: BoardIdParam,
  name: z.string().describe('Board display name'),
  url: z.string().optional().describe('Full board URL'),
  organization: z
    .object({
      id: z.string().describe('Organization ID'),
      name: z.string().describe('Organization slug/name'),
      displayName: z.string().describe('Organization display name'),
    })
    .optional()
    .describe(
      'Embedded organization data. Present only when boardOrganization: true is passed.',
    ),
});

export const SearchMemberSchema = z.object({
  id: MemberIdParam,
  username: z.string().describe('Member username'),
  fullName: z.string().describe('Member display name'),
  avatarUrl: z.string().nullable().describe('Avatar image URL'),
});

export const SearchOrganizationSchema = z.object({
  id: z.string().describe('Organization ID'),
  name: z.string().describe('Organization slug/handle'),
  displayName: z.string().describe('Organization display name'),
  desc: z.string().optional().describe('Organization description'),
  url: z.string().optional().describe('Organization URL'),
  logoHash: z.string().nullable().optional().describe('Logo hash'),
  logoUrl: z.string().nullable().optional().describe('Logo URL'),
  website: z
    .string()
    .nullable()
    .optional()
    .describe('Organization website URL'),
});

// ============================================================================
// Function Schemas
// ============================================================================

export const searchSchema = {
  name: 'search',
  description:
    'Search across boards, cards, and members. Returns separate result arrays for each model type.',
  notes:
    'modelTypes defaults to "cards,boards,members". Use cards_limit, boards_limit, members_limit to control result counts. Query supports operators: edited:day/week/month/N (filter by edit date), is:open (open only), is:starred (starred boards only), sort:edited (sort by last edited), description:term (search in descriptions), board:id (limit to board).',
  input: z.object({
    query: z
      .string()
      .describe(
        'Search query string. Supports operators: edited:day/week/month/N (filter by edit date), is:open (open cards/boards only), is:starred (starred boards only), sort:edited (sort by last edited), description:term (search in card descriptions), board:boardId (limit to a specific board).',
      ),
    modelTypes: z
      .string()
      .optional()
      .describe(
        'Comma-separated model types to search. Default: "cards,boards,members". Options: cards, boards, members, organizations, actions',
      ),
    cardsLimit: z
      .number()
      .optional()
      .describe('Max number of card results. Default: 10'),
    boardsLimit: z
      .number()
      .optional()
      .describe('Max number of board results. Default: 10'),
    membersLimit: z
      .number()
      .optional()
      .describe('Max number of member results. Default: 10'),
    partial: z
      .boolean()
      .optional()
      .describe(
        'When true, allows partial word matching (prefix search). Default: false. The Trello UI enables this by default.',
      ),
    cardsPage: z
      .number()
      .optional()
      .describe(
        'Page number for card result pagination (0-indexed). Use with cardsLimit for offset-based pagination. Default: 0.',
      ),
    cardBoard: z
      .boolean()
      .optional()
      .describe(
        'When true, embeds board data (id, name, shortLink) on each card result. Default: false.',
      ),
    cardList: z
      .boolean()
      .optional()
      .describe(
        'When true, embeds list data (id, name) on each card result. Default: false.',
      ),
    boardOrganization: z
      .boolean()
      .optional()
      .describe(
        'When true, embeds organization data on each board result. Default: false.',
      ),
    boardOrganizationFields: z
      .string()
      .optional()
      .describe(
        'Comma-separated fields to include on the embedded organization object when boardOrganization=true. Example: "id,displayName".',
      ),
    memberFields: z
      .string()
      .optional()
      .describe(
        'Comma-separated fields to include on each member result. Example: "id,avatarUrl,fullName,initials,username". Defaults to all fields.',
      ),
    organizationFields: z
      .string()
      .optional()
      .describe(
        'Comma-separated fields to include on each organization result (when organizations is in modelTypes). Example: "id,displayName,logoHash,name".',
      ),
  }),
  output: z.object({
    cards: z.array(SearchCardSchema).describe('Matching cards'),
    boards: z.array(SearchBoardSchema).describe('Matching boards'),
    members: z.array(SearchMemberSchema).describe('Matching members'),
    organizations: z
      .array(SearchOrganizationSchema)
      .describe(
        'Matching organizations. Populated only when "organizations" is included in modelTypes.',
      ),
    actions: z
      .array(ActionSchema)
      .describe(
        'Matching actions. Populated only when "actions" is included in modelTypes.',
      ),
  }),
};

export type SearchInput = z.infer<typeof searchSchema.input>;
export type SearchOutput = z.infer<typeof searchSchema.output>;

export const listBoardActivitySchema = {
  name: 'listBoardActivity',
  description:
    'List recent actions (activity feed) on a board. Returns up to 50 actions sorted newest-first.',
  notes:
    'Two pagination modes: cursor-based (before= with last action ID) or page-based (page=0,1,2…). The Trello UI uses page= with display=true for human-readable activity feeds.',
  input: z.object({
    boardId: BoardIdParam,
    limit: z
      .number()
      .optional()
      .describe('Max number of actions to return. Default: 50, max: 1000'),
    before: z
      .string()
      .optional()
      .describe(
        'Cursor for pagination: pass the ID of the last action from the previous page',
      ),
    since: z
      .string()
      .optional()
      .describe(
        'Filter actions newer than this value. Accepts an ISO 8601 date string (e.g. "2026-01-01T00:00:00Z") or an action ID. Only actions with a date after this value are returned.',
      ),
    filter: z
      .string()
      .optional()
      .describe(
        'Comma-separated action type filter. Default: all types. Example: "commentCard,updateCard". Invalid or misspelled values silently return 0 results; no error is thrown.',
      ),
    fields: z
      .string()
      .optional()
      .describe(
        'Comma-separated list of fields to include on each action object. Default includes all fields. Example: "id,type,date,data" to reduce response size. Note: this param does NOT control the memberCreator object; use memberCreator=false to omit it.',
      ),
    memberCreator: z
      .boolean()
      .optional()
      .describe(
        'Whether to include the memberCreator object on each action. Default: true. Pass false to omit creator info and reduce response size.',
      ),
    memberCreator_fields: z
      .string()
      .optional()
      .describe(
        'Comma-separated fields to include on each memberCreator object. Default includes all fields. Example: "id,fullName,username,avatarUrl,initials".',
      ),
    member: z
      .boolean()
      .optional()
      .describe(
        'Whether to include member data on actions that have an associated member (e.g. addMemberToCard). Default: false.',
      ),
    member_fields: z
      .string()
      .optional()
      .describe(
        'Comma-separated fields to include on each member object embedded in actions (when member=true). Example: "id,fullName,username".',
      ),
    entities: z
      .boolean()
      .optional()
      .describe(
        'Whether to include a structured entities summary on each action. Default: false.',
      ),
    reactions: z
      .boolean()
      .optional()
      .describe(
        'Whether to include reactions (emoji reactions) on each action. Default: false.',
      ),
    page: z
      .number()
      .optional()
      .describe(
        'Page number for offset-based pagination (0-indexed). page=0 returns the first `limit` actions, page=1 the next `limit`, etc. Alternative to before= cursor pagination. The Trello UI uses this for the board activity panel.',
      ),
    display: z
      .boolean()
      .optional()
      .describe(
        'When true, includes a display field on each action with translationKey (i18n key, e.g. "action_remove_checklist_from_card") and entities (named objects referenced by the action). Used by the Trello UI to render human-readable activity descriptions. Default: false.',
      ),
  }),
  output: z.object({
    actions: z.array(ActionSchema).describe('Actions sorted newest-first'),
    nextCursor: z
      .string()
      .nullable()
      .describe(
        'ID of the last action in this page; pass as before= to fetch older actions. Null if this is the last page (fewer results returned than the requested limit).',
      ),
  }),
};

export type ListBoardActivityInput = z.infer<
  typeof listBoardActivitySchema.input
>;
export type ListBoardActivityOutput = z.infer<
  typeof listBoardActivitySchema.output
>;

export const listCardActivitySchema = {
  name: 'listCardActivity',
  description:
    'List all activity on a specific card: comments, moves, label changes, member assignments, etc.',
  notes:
    'Returns all action types by default (filter=all). Use before= with the last action ID for cursor-based pagination.',
  input: z.object({
    cardId: CardIdParam,
    limit: z
      .number()
      .optional()
      .describe('Max number of actions to return. Default: 50, max: 1000'),
    before: z
      .string()
      .optional()
      .describe(
        'Cursor for pagination: pass the ID of the last action from the previous page',
      ),
    since: z
      .string()
      .optional()
      .describe(
        'Filter actions newer than this value. Accepts an ISO 8601 date string (e.g. "2026-01-01T00:00:00Z") or an action ID. Only actions with a date after this value are returned.',
      ),
    filter: z
      .string()
      .optional()
      .describe(
        'Comma-separated action type filter. Default: all types. Example: "commentCard,updateCard"',
      ),
    fields: z
      .string()
      .optional()
      .describe(
        'Comma-separated list of fields to include on each action object. Default includes all fields. Example: "id,type,date,data" to reduce response size.',
      ),
    memberCreator: z
      .boolean()
      .optional()
      .describe(
        'Whether to include the memberCreator object on each action. Default: true. Pass false to omit creator info and reduce response size.',
      ),
    memberCreator_fields: z
      .string()
      .optional()
      .describe(
        'Comma-separated fields to include on each memberCreator object. Default includes all fields. Example: "id,fullName,username,avatarUrl,initials".',
      ),
    member: z
      .boolean()
      .optional()
      .describe(
        'Whether to include member data on actions that have an associated member (e.g. addMemberToCard). Default: false.',
      ),
    member_fields: z
      .string()
      .optional()
      .describe(
        'Comma-separated fields to include on each member object embedded in actions (when member=true). Example: "id,fullName,username".',
      ),
    entities: z
      .boolean()
      .optional()
      .describe(
        'Whether to include a structured entities summary on each action. Default: false.',
      ),
    reactions: z
      .boolean()
      .optional()
      .describe(
        'Whether to include reactions (emoji reactions) on each action. Default: false.',
      ),
    page: z
      .number()
      .optional()
      .describe(
        'Page number for offset-based pagination (0-indexed). page=0 returns the first `limit` actions, page=1 the next `limit`, etc. Alternative to before= cursor pagination.',
      ),
    display: z
      .boolean()
      .optional()
      .describe(
        'When true, includes a display field on each action with translationKey (i18n key) and entities (named objects referenced by the action). Useful for rendering human-readable activity descriptions. Default: false.',
      ),
  }),
  output: z.object({
    actions: z.array(ActionSchema).describe('Actions sorted newest-first'),
    nextCursor: z
      .string()
      .nullable()
      .describe(
        'ID of the last action in this page; pass as before= to fetch older actions. Null if this is the last page.',
      ),
  }),
};

export type ListCardActivityInput = z.infer<
  typeof listCardActivitySchema.input
>;
export type ListCardActivityOutput = z.infer<
  typeof listCardActivitySchema.output
>;

export const listMemberActivitySchema = {
  name: 'listMemberActivity',
  description:
    "List all actions performed by a member. Useful for auditing a team member's recent Trello activity.",
  notes:
    'Use "me" as memberId for the current user. Use before= with the last action ID for cursor-based pagination.',
  input: z.object({
    memberId: z
      .string()
      .optional()
      .describe(
        'Member ID or "me" for the current authenticated user. Defaults to "me" (the current user) when not provided.',
      ),
    limit: z
      .number()
      .optional()
      .describe('Max number of actions to return. Default: 50, max: 1000'),
    before: z
      .string()
      .optional()
      .describe(
        'Cursor for pagination: pass the ID of the last action from the previous page',
      ),
    since: z
      .string()
      .optional()
      .describe(
        'Filter actions newer than this value. Accepts an ISO 8601 date string (e.g. "2026-01-01T00:00:00Z") or an action ID. Only actions with a date after this value are returned.',
      ),
    filter: z
      .string()
      .optional()
      .describe(
        'Comma-separated action type filter. Default: all types. Example: "commentCard,updateCard"',
      ),
    fields: z
      .string()
      .optional()
      .describe(
        'Comma-separated list of fields to include on each action object. Default includes all fields. Example: "id,type,date,data" to reduce response size. Note: this param does NOT control the memberCreator object; use memberCreator=false to omit it.',
      ),
    memberCreator: z
      .boolean()
      .optional()
      .describe(
        'Whether to include the memberCreator object on each action. Default: true. Pass false to omit creator info and reduce response size.',
      ),
    memberCreator_fields: z
      .string()
      .optional()
      .describe(
        'Comma-separated fields to include on each memberCreator object. Default includes all fields. Example: "id,fullName,username,avatarUrl,initials".',
      ),
    member: z
      .boolean()
      .optional()
      .describe(
        'Whether to include member data on actions that have an associated member (e.g. addMemberToCard). Default: false.',
      ),
    member_fields: z
      .string()
      .optional()
      .describe(
        'Comma-separated fields to include on each member object embedded in actions (when member=true). Example: "id,fullName,username".',
      ),
    entities: z
      .boolean()
      .optional()
      .describe(
        'Whether to include a structured entities summary on each action. Default: false.',
      ),
    reactions: z
      .boolean()
      .optional()
      .describe(
        'Whether to include reactions (emoji reactions) on each action. Default: false.',
      ),
    page: z
      .number()
      .optional()
      .describe(
        'Page number for offset-based pagination (0-indexed). page=0 returns the first `limit` actions, page=1 the next `limit`, etc. Alternative to before= cursor pagination.',
      ),
    display: z
      .boolean()
      .optional()
      .describe(
        'When true, includes a display field on each action with translationKey (i18n key) and entities (named objects referenced by the action). Useful for rendering human-readable activity descriptions. Default: false.',
      ),
  }),
  output: z.object({
    actions: z.array(ActionSchema).describe('Actions sorted newest-first'),
    nextCursor: z
      .string()
      .nullable()
      .describe(
        'ID of the last action in this page; pass as before= to fetch older actions. Null if this is the last page.',
      ),
  }),
};

export type ListMemberActivityInput = z.infer<
  typeof listMemberActivitySchema.input
>;
export type ListMemberActivityOutput = z.infer<
  typeof listMemberActivitySchema.output
>;

export const listNotificationsSchema = {
  name: 'listNotifications',
  description:
    'Get grouped notifications for the current user. Returns unread notifications by default.',
  notes:
    'Use skip for offset pagination or before= for cursor-based pagination. Set readFilter to "all" to include read notifications. Use filter to narrow by notification type (e.g. "commentCard,mentionedOnCard").',
  input: z.object({
    limit: z
      .number()
      .optional()
      .describe(
        'Max number of notification groups to return. Default: 10, max: 50',
      ),
    skip: z
      .number()
      .optional()
      .describe('Number of groups to skip for offset pagination. Default: 0'),
    readFilter: z
      .enum(['unread', 'all'])
      .optional()
      .describe(
        'Filter by read status. Default: "unread". Pass "all" to include already-read notifications.',
      ),
    filter: z
      .string()
      .optional()
      .describe(
        'Comma-separated notification type filter. Examples: "commentCard", "mentionedOnCard", "addedToCard", "changeCard", "cardDueSoon", "updateCheckItemStateOnCard", "addedMemberToCard". Omit for all types.',
      ),
    before: z
      .string()
      .optional()
      .describe(
        'Cursor for pagination: pass the ID of the last notification group from the previous page to fetch older notifications.',
      ),
    since: z
      .string()
      .optional()
      .describe(
        'Filter notifications newer than this value. Accepts an ISO 8601 date string (e.g. "2026-01-01T00:00:00Z") or a notification ID.',
      ),
    memberCreator: z
      .boolean()
      .optional()
      .describe(
        'Whether to include the memberCreator object on each notification. Default: true.',
      ),
    memberCreator_fields: z
      .string()
      .optional()
      .describe(
        'Comma-separated fields to include on the memberCreator object. Example: "id,fullName,username,avatarUrl".',
      ),
    board: z
      .boolean()
      .optional()
      .describe(
        'Whether to include board data on notifications that reference a board.',
      ),
    board_fields: z
      .string()
      .optional()
      .describe(
        'Comma-separated fields to include on embedded board objects. Example: "id,name,shortLink".',
      ),
    card: z
      .boolean()
      .optional()
      .describe(
        'Whether to include card data on notifications that reference a card.',
      ),
    card_fields: z
      .string()
      .optional()
      .describe(
        'Comma-separated fields to include on embedded card objects. Example: "id,name,shortLink".',
      ),
    list: z
      .boolean()
      .optional()
      .describe(
        'Whether to include list data on notifications that reference a list.',
      ),
    list_fields: z
      .string()
      .optional()
      .describe(
        'Comma-separated fields to include on embedded list objects. Example: "id,name".',
      ),
    member: z
      .boolean()
      .optional()
      .describe(
        'Whether to include the associated member object on notifications that reference a member (e.g. addedMemberToCard).',
      ),
    member_fields: z
      .string()
      .optional()
      .describe(
        'Comma-separated fields to include on embedded member objects. Example: "id,fullName,username".',
      ),
    display: z
      .boolean()
      .optional()
      .describe(
        'When true, includes a display field with translationKey and entities for human-readable rendering. Default: false.',
      ),
    entities: z
      .boolean()
      .optional()
      .describe(
        'Whether to include a structured entities summary on each notification. Default: false.',
      ),
    reactions: z
      .boolean()
      .optional()
      .describe(
        'Whether to include emoji reactions on each notification. Default: false.',
      ),
    page: z
      .number()
      .optional()
      .describe(
        'Page number for offset-based pagination (0-indexed). Alternative to skip= for some pagination patterns.',
      ),
    fields: z
      .string()
      .optional()
      .describe(
        'Comma-separated list of fields to include on each notification. Default includes all fields.',
      ),
  }),
  output: z.object({
    groups: z
      .array(z.record(z.string(), z.unknown()))
      .describe(
        'Notification groups. Each group contains notifications of a similar type. Common fields: id, unread, type, date, data, memberCreator, card, board',
      ),
  }),
};

export type ListNotificationsInput = z.infer<
  typeof listNotificationsSchema.input
>;
export type ListNotificationsOutput = z.infer<
  typeof listNotificationsSchema.output
>;

export const getNotificationsCountSchema = {
  name: 'getNotificationsCount',
  description:
    'Get the total count of unread notifications for the current user (the bell badge count).',
  notes:
    'Returns 0 when there are no unread notifications (API returns {} in that case, which the implementation normalizes to {count: 0}).',
  input: z.object({}),
  output: z.object({
    count: z
      .number()
      .describe('Total number of unread notifications (the bell badge number)'),
  }),
};

export type GetNotificationsCountInput = z.infer<
  typeof getNotificationsCountSchema.input
>;
export type GetNotificationsCountOutput = z.infer<
  typeof getNotificationsCountSchema.output
>;

export const markNotificationsReadSchema = {
  name: 'markNotificationsRead',
  description:
    'Mark notifications as read or unread. Without ids, marks all notifications. With ids, marks only the specified notifications.',
  notes:
    'Omit ids to mark all notifications as read (resets the bell badge to zero). Pass ids to mark specific notifications. Pass read=false to mark as unread instead of read.',
  input: z.object({
    dsc: DscParam,
    read: z
      .boolean()
      .optional()
      .describe(
        'Whether to mark as read (true) or unread (false). Default: true (mark as read).',
      ),
    ids: z
      .array(z.string())
      .optional()
      .describe(
        'Notification IDs to mark. Obtain IDs from listNotifications. Omit to mark all notifications.',
      ),
  }),
  output: z.object({
    success: z
      .boolean()
      .describe('True if notifications were successfully marked'),
  }),
};

export type MarkNotificationsReadInput = z.infer<
  typeof markNotificationsReadSchema.input
>;
export type MarkNotificationsReadOutput = z.infer<
  typeof markNotificationsReadSchema.output
>;

export const listAttachmentsSchema = {
  name: 'listAttachments',
  description: 'List all attachments on a card.',
  notes:
    'filter defaults to "false" (all attachments). Use "cover" to fetch only the single attachment set as the card cover/thumbnail; returns an empty array if no cover is set. fields defaults to "all"; pass a comma-separated list (e.g. "id,name,url") to reduce response payload.',
  input: z.object({
    cardId: CardIdParam,
    filter: z
      .enum(['false', 'cover'])
      .optional()
      .describe(
        'Filter attachments by type. "false" returns all attachments (default). "cover" returns only the card cover attachment (the single image set as the card thumbnail).',
      ),
    fields: z
      .string()
      .optional()
      .describe(
        'Comma-separated list of attachment fields to return, or "all" for all fields (default). Example: "id,name,url,mimeType". Available fields: id, bytes, date, edgeColor, idMember, isUpload, mimeType, name, pos, previews, url, fileName.',
      ),
  }),
  output: z.object({
    attachments: z.array(AttachmentSchema).describe('Attachments on the card'),
  }),
};

export type ListAttachmentsInput = z.infer<typeof listAttachmentsSchema.input>;
export type ListAttachmentsOutput = z.infer<
  typeof listAttachmentsSchema.output
>;

export const createAttachmentSchema = {
  name: 'createAttachment',
  description: 'Add a URL attachment to a card.',
  notes:
    'Only URL attachments are supported (not file uploads). The url field is required. Use setCover: true to set the attachment as the card cover; the URL must resolve to a previewable image.',
  input: z.object({
    dsc: DscParam,
    cardId: CardIdParam,
    url: z.string().describe('URL of the attachment to add'),
    name: z
      .string()
      .optional()
      .describe(
        'Display name for the attachment. Defaults to the URL if not provided',
      ),
    mimeType: z
      .string()
      .optional()
      .describe('MIME type of the attachment (e.g. "application/pdf")'),
    setCover: z
      .boolean()
      .optional()
      .describe(
        'Set this attachment as the card cover. Requires the URL to resolve to a previewable image (e.g. JPEG, PNG). Returns 400 if the image cannot be previewed.',
      ),
    pos: z
      .union([z.enum(['top', 'bottom']), z.number()])
      .optional()
      .describe(
        'Position of this attachment among other attachments. "top" places it first, "bottom" places it last, or a positive number for a specific position.',
      ),
  }),
  output: z.object({
    attachment: AttachmentSchema.describe('The newly created attachment'),
  }),
};

export type CreateAttachmentInput = z.infer<
  typeof createAttachmentSchema.input
>;
export type CreateAttachmentOutput = z.infer<
  typeof createAttachmentSchema.output
>;

export const deleteAttachmentSchema = {
  name: 'deleteAttachment',
  description: 'Delete an attachment from a card. This action is irreversible.',
  notes: '',
  input: z.object({
    dsc: DscParam,
    cardId: CardIdParam,
    attachmentId: z.string().describe('Attachment ID to delete'),
  }),
  output: z.object({
    success: z
      .boolean()
      .describe('True if the attachment was deleted successfully'),
  }),
};

export type DeleteAttachmentInput = z.infer<
  typeof deleteAttachmentSchema.input
>;
export type DeleteAttachmentOutput = z.infer<
  typeof deleteAttachmentSchema.output
>;

export const listCustomFieldsSchema = {
  name: 'listCustomFields',
  description:
    'List all custom field definitions on a board. Returns field names, types, and options.',
  notes: 'Requires Trello Standard+ plan. Returns 403 on free boards.',
  input: z.object({
    boardId: BoardIdParam,
  }),
  output: z.object({
    customFields: z
      .array(CustomFieldSchema)
      .describe('Custom field definitions on the board'),
  }),
};

export type ListCustomFieldsInput = z.infer<
  typeof listCustomFieldsSchema.input
>;
export type ListCustomFieldsOutput = z.infer<
  typeof listCustomFieldsSchema.output
>;

export const CustomFieldItemSchema = z.object({
  id: z.string().describe('Custom field item ID'),
  value: z
    .record(z.string(), z.string().nullable())
    .nullable()
    .describe(
      'The stored value object for text/number/date/checkbox fields (e.g. {text:"hello"}). Null for list-type fields (which use idValue instead).',
    ),
  idValue: z
    .string()
    .nullable()
    .describe(
      'For list-type fields: the selected option ID, or null when cleared. Null for all other field types.',
    ),
  idCustomField: z
    .string()
    .describe('Custom field definition ID this item belongs to'),
  idModel: z.string().describe('Card ID this custom field item is on'),
  modelType: z.string().describe('Always "card"'),
});

export const setCustomFieldValueSchema = {
  name: 'setCustomFieldValue',
  description:
    'Set a custom field value on a card. The value shape depends on the field type.',
  notes:
    'Requires Trello Standard+ plan. For text/number/date/checkbox fields: pass value={text:"..."}, value={number:"123"}, value={date:"ISO8601"}, value={checked:"true"/"false"}; all values as strings. For list-type (dropdown) fields: pass idValue="optionId" as a top-level param instead of value, NOT inside the value object. To clear: pass value={text:""} for text fields, or idValue="" for list fields.',
  input: z.object({
    dsc: DscParam,
    cardId: CardIdParam,
    fieldId: z
      .string()
      .describe('Custom field definition ID (from listCustomFields)'),
    value: z
      .record(z.string(), z.string())
      .optional()
      .describe(
        'Field value object for text/number/date/checkbox fields. Shape by type: text={text:"..."}, number={number:"123"}, date={date:"ISO8601"}, checkbox={checked:"true"/"false"}. Pass {text:""} to clear a text field. Not used for list-type fields; use idValue instead.',
      ),
    idValue: z
      .string()
      .optional()
      .describe(
        'For list-type (dropdown) custom fields: the option ID to select. Get option IDs from listCustomFields options[].id. Pass empty string "" to clear the selection. Do not use together with value; use one or the other depending on field type.',
      ),
  }),
  output: z.object({
    success: z
      .boolean()
      .describe('True if the custom field value was set successfully'),
    id: z
      .string()
      .optional()
      .describe('Custom field item ID returned by the API'),
    value: z
      .record(z.string(), z.string().nullable())
      .nullable()
      .optional()
      .describe(
        'The stored value object (for text/number/date/checkbox fields), or null for list-type fields.',
      ),
    idValue: z
      .string()
      .nullable()
      .optional()
      .describe(
        'For list-type fields: the selected option ID, or null when cleared.',
      ),
    idCustomField: z.string().optional().describe('Custom field definition ID'),
    idModel: z.string().optional().describe('Card ID'),
    modelType: z.string().optional().describe('Always "card"'),
  }),
};

export type SetCustomFieldValueInput = z.infer<
  typeof setCustomFieldValueSchema.input
>;
export type SetCustomFieldValueOutput = z.infer<
  typeof setCustomFieldValueSchema.output
>;

export const bulkMoveCardsSchema = {
  name: 'bulkMoveCards',
  description:
    'Move multiple cards to a target list. Executes sequentially with rate limiting.',
  notes:
    'Executes sequentially with rate limiting (100ms delay between calls). Returns per-card succeeded/failed summary.',
  input: z.object({
    dsc: DscParam,
    cardIds: z.array(z.string()).describe('Array of card IDs to move'),
    idList: z.string().describe('Target list ID to move the cards into'),
    idBoard: z
      .string()
      .optional()
      .describe('Target board ID (required when moving cards across boards)'),
    pos: z
      .union([z.enum(['top', 'bottom']), z.number()])
      .optional()
      .describe(
        'Position for each card in the target list. "top" places cards at the top, "bottom" at the bottom, or a positive number for a specific position. Defaults to the Trello API default (bottom) when omitted.',
      ),
  }),
  output: BulkResultSchema,
};

export type BulkMoveCardsInput = z.infer<typeof bulkMoveCardsSchema.input>;
export type BulkMoveCardsOutput = z.infer<typeof bulkMoveCardsSchema.output>;

export const bulkArchiveCardsSchema = {
  name: 'bulkArchiveCards',
  description:
    'Archive multiple cards at once. Accepts either a list of card IDs or a list ID to archive all cards in a list.',
  notes:
    'Two modes: (1) cardIds[]: archives specific cards sequentially with rate limiting; (2) listId: archives all cards in a list in one API call. Provide one or the other, not both.',
  input: z.object({
    dsc: DscParam,
    cardIds: z
      .array(z.string())
      .optional()
      .describe(
        'Array of specific card IDs to archive. Use this OR listId, not both.',
      ),
    listId: z
      .string()
      .optional()
      .describe(
        'Archive all cards in this list ID in one operation. Use this OR cardIds, not both.',
      ),
  }),
  output: z.object({
    succeeded: z
      .array(z.string())
      .describe(
        'IDs of cards that were successfully archived (cardIds mode only)',
      ),
    failed: z
      .array(
        z.object({
          id: z.string().describe('Card ID that failed'),
          error: z.string().describe('Error message'),
        }),
      )
      .describe('Cards that failed (cardIds mode only)'),
    allArchived: z
      .boolean()
      .optional()
      .describe(
        'True when listId mode was used; all cards in the list were archived',
      ),
  }),
};

export type BulkArchiveCardsInput = z.infer<
  typeof bulkArchiveCardsSchema.input
>;
export type BulkArchiveCardsOutput = z.infer<
  typeof bulkArchiveCardsSchema.output
>;

export const bulkAddLabelToCardsSchema = {
  name: 'bulkAddLabelToCards',
  description:
    'Add a label to multiple cards at once. Executes sequentially with rate limiting.',
  notes:
    'Executes sequentially with rate limiting (100ms delay between calls). The label must already exist on the board. Returns per-card succeeded/failed summary.',
  input: z.object({
    dsc: DscParam,
    cardIds: z
      .array(z.string())
      .describe('Array of card IDs to add the label to'),
    labelId: z
      .string()
      .describe('Label ID to add to each card (must exist on the board)'),
  }),
  output: BulkResultSchema,
};

export type BulkAddLabelToCardsInput = z.infer<
  typeof bulkAddLabelToCardsSchema.input
>;
export type BulkAddLabelToCardsOutput = z.infer<
  typeof bulkAddLabelToCardsSchema.output
>;

// ============================================================================
// Domain Schema Array
// ============================================================================

export const miscSchemas = [
  searchSchema,
  listBoardActivitySchema,
  listCardActivitySchema,
  listMemberActivitySchema,
  listNotificationsSchema,
  getNotificationsCountSchema,
  markNotificationsReadSchema,
  listAttachmentsSchema,
  createAttachmentSchema,
  deleteAttachmentSchema,
  listCustomFieldsSchema,
  setCustomFieldValueSchema,
  bulkMoveCardsSchema,
  bulkArchiveCardsSchema,
  bulkAddLabelToCardsSchema,
];
