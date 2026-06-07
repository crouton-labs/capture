import { z } from 'zod';
import {
  DscParam,
  BoardIdParam,
  CardIdParam,
  MemberIdParam,
  CardMemberSchema,
} from '../params';

// ============================================================================
// Function Schemas
// ============================================================================

export const getContextSchema = {
  name: 'getContext',
  description:
    'Get Trello authentication context including the CSRF token and current member info. Must be called before any write operation to obtain the dsc token.',
  notes: '',
  input: z.object({}),
  output: z.object({
    dsc: DscParam,
    memberId: MemberIdParam,
    username: z.string().describe('Current member username'),
    fullName: z.string().describe('Current member display name'),
  }),
};

export type GetContextInput = z.infer<typeof getContextSchema.input>;
export type GetContextOutput = z.infer<typeof getContextSchema.output>;

export const getMeSchema = {
  name: 'getMe',
  description:
    "Get the current authenticated member's full profile, including preferences, board memberships, and organization memberships. Optionally embed boards, organizations, and cards.",
  notes: '',
  input: z.object({
    boards: z
      .enum(['none', 'open', 'closed', 'all', 'starred', 'pinned'])
      .optional()
      .describe(
        "Embed boards in the response. 'open' = active boards only, 'all' = includes closed boards, 'starred' = only starred boards",
      ),
    board_fields: z
      .string()
      .optional()
      .describe(
        "Comma-separated board fields to include when boards are embedded. E.g. 'id,name,shortLink,url,closed,idOrganization'",
      ),
    organizations: z
      .enum(['none', 'all', 'members', 'public', 'normal'])
      .optional()
      .describe(
        "Embed organizations in the response. 'all' = all orgs the member belongs to",
      ),
    organization_fields: z
      .string()
      .optional()
      .describe(
        "Comma-separated organization fields to include when organizations are embedded. E.g. 'id,displayName,name,url'",
      ),
    cards: z
      .enum(['none', 'visible', 'open', 'closed', 'all'])
      .optional()
      .describe(
        'Embed cards assigned to this member in the response. Useful to see all assigned work.',
      ),
    boardStars: z
      .boolean()
      .optional()
      .describe(
        'When true, embed board stars (starred board positions) in the response.',
      ),
  }),
  output: z.object({
    id: MemberIdParam,
    username: z.string().describe('Member username (unique handle)'),
    fullName: z.string().describe('Member display name'),
    email: z
      .string()
      .nullable()
      .describe('Email address associated with the account'),
    avatarUrl: z
      .string()
      .nullable()
      .describe('Avatar image URL, or null if not set'),
    initials: z.string().describe('Member initials derived from full name'),
    bio: z.string().describe("Member's bio/description (may be empty string)"),
    url: z.string().describe("URL to this member's public Trello profile"),
    idBoards: z
      .array(z.string())
      .describe('IDs of all boards the member has access to'),
    idOrganizations: z
      .array(z.string())
      .describe('IDs of all workspaces/organizations the member belongs to'),
    confirmed: z
      .boolean()
      .describe('Whether the member has confirmed their email address'),
    memberType: z.string().describe('Account type (e.g. "normal", "ghost")'),
    prefs: z
      .object({
        sendSummaries: z
          .boolean()
          .describe('Whether email summaries are enabled'),
        minutesBetweenSummaries: z
          .number()
          .describe('Interval between email summaries in minutes'),
        minutesBeforeDeadlineToNotify: z
          .number()
          .describe('Minutes before due date to send notification'),
        colorBlind: z.boolean().describe('Whether color-blind mode is enabled'),
        locale: z.string().describe('Member locale (e.g. "en-US")'),
        timezone: z
          .string()
          .describe('Member timezone (e.g. "America/New_York")'),
      })
      .passthrough()
      .describe('Member preference settings'),
    boards: z
      .array(
        z
          .object({
            id: z.string(),
            name: z.string(),
            closed: z.boolean(),
            idOrganization: z.string().nullable(),
            pinned: z.boolean().nullable(),
          })
          .passthrough(),
      )
      .optional()
      .describe('Embedded boards (only present when boards param is provided)'),
    organizations: z
      .array(
        z
          .object({
            id: z.string(),
            name: z.string(),
            displayName: z.string(),
          })
          .passthrough(),
      )
      .optional()
      .describe(
        'Embedded organizations (only present when organizations param is provided)',
      ),
    cards: z
      .array(
        z
          .object({
            id: z.string(),
            name: z.string(),
            idList: z.string(),
            idBoard: z.string(),
          })
          .passthrough(),
      )
      .optional()
      .describe(
        'Embedded cards assigned to this member (only present when cards param is provided)',
      ),
    boardStars: z
      .array(
        z.object({
          id: z.string(),
          idBoard: z.string(),
          pos: z.number(),
        }),
      )
      .optional()
      .describe(
        'Embedded board stars (only present when boardStars param is true)',
      ),
  }),
};

export type GetMeInput = z.infer<typeof getMeSchema.input>;
export type GetMeOutput = z.infer<typeof getMeSchema.output>;

export const getMemberSchema = {
  name: 'getMember',
  description:
    "Get a specific member's public profile by their ID or username.",
  notes:
    'Returns only publicly visible fields. Use getMe for the full authenticated profile. Use boards/organizations/cards/actions params to embed related resources in a single request.',
  input: z.object({
    memberId: z
      .string()
      .describe('Member ID (24-char hex string) or username (e.g. "jsmith")'),
    fields: z
      .string()
      .optional()
      .describe(
        'Comma-separated list of member fields to return, or "all" for all fields, or "none". E.g. "id,username,fullName,email,avatarUrl"',
      ),
    boards: z
      .enum([
        'all',
        'open',
        'closed',
        'starred',
        'pinned',
        'public',
        'organization',
        'mine',
        'none',
      ])
      .optional()
      .describe(
        'Embed boards this member belongs to, filtered by status. E.g. "open" returns only open boards.',
      ),
    board_fields: z
      .string()
      .optional()
      .describe(
        'Comma-separated board fields to include when boards param is set. E.g. "name,shortLink,url"',
      ),
    organizations: z
      .enum(['all', 'public', 'members', 'none'])
      .optional()
      .describe(
        'Embed organizations/workspaces this member belongs to, filtered by type.',
      ),
    organization_fields: z
      .string()
      .optional()
      .describe(
        'Comma-separated organization fields to include when organizations param is set. E.g. "name,displayName,url"',
      ),
    cards: z
      .enum(['all', 'closed', 'none', 'open', 'visible'])
      .optional()
      .describe('Embed cards assigned to this member, filtered by status.'),
    card_fields: z
      .string()
      .optional()
      .describe(
        'Comma-separated card fields to include when cards param is set. E.g. "name,idList,idBoard,due"',
      ),
    actions: z
      .string()
      .optional()
      .describe(
        'Embed recent actions for this member. Use "all" for all types, or a filter like "commentCard". Returns up to actions_limit entries.',
      ),
    actions_limit: z
      .number()
      .optional()
      .describe(
        'Maximum number of actions to return when actions param is set. Default 50.',
      ),
    boardStars: z
      .boolean()
      .optional()
      .describe("Include the member's board stars (pinned boards)."),
    boardsInvited: z
      .enum([
        'all',
        'open',
        'closed',
        'starred',
        'pinned',
        'public',
        'organization',
        'mine',
        'none',
      ])
      .optional()
      .describe('Embed boards this member has been invited to.'),
    boardsInvited_fields: z
      .string()
      .optional()
      .describe(
        'Comma-separated board fields to include for boardsInvited. E.g. "name,shortLink"',
      ),
    organizationsInvited: z
      .enum(['all', 'public', 'members', 'none'])
      .optional()
      .describe('Embed organizations this member has been invited to.'),
    organizationsInvited_fields: z
      .string()
      .optional()
      .describe(
        'Comma-separated organization fields to include for organizationsInvited.',
      ),
  }),
  output: z
    .object({
      id: MemberIdParam,
      username: z.string().describe('Member username'),
      fullName: z.string().describe('Member display name'),
      avatarUrl: z
        .string()
        .nullable()
        .describe('Avatar image URL, or null if not set'),
      initials: z.string().describe('Member initials'),
      url: z.string().describe("URL to this member's public Trello profile"),
      bio: z
        .string()
        .describe("Member's bio/description (may be empty string)"),
      boards: z
        .array(z.object({ id: z.string(), name: z.string() }).passthrough())
        .optional()
        .describe('Embedded boards (present when boards param is set)'),
      organizations: z
        .array(z.object({ id: z.string(), name: z.string() }).passthrough())
        .optional()
        .describe(
          'Embedded organizations (present when organizations param is set)',
        ),
      cards: z
        .array(z.object({ id: z.string(), name: z.string() }).passthrough())
        .optional()
        .describe('Embedded cards (present when cards param is set)'),
      actions: z
        .array(z.object({ id: z.string(), type: z.string() }).passthrough())
        .optional()
        .describe(
          'Embedded recent actions (present when actions param is set)',
        ),
      boardStars: z
        .array(z.object({ id: z.string(), idBoard: z.string() }).passthrough())
        .optional()
        .describe(
          "Member's board stars/pins (present when boardStars is true)",
        ),
      boardsInvited: z
        .array(z.object({ id: z.string(), name: z.string() }).passthrough())
        .optional()
        .describe(
          'Boards the member was invited to (present when boardsInvited param is set)',
        ),
      organizationsInvited: z
        .array(z.object({ id: z.string(), name: z.string() }).passthrough())
        .optional()
        .describe(
          'Organizations the member was invited to (present when organizationsInvited param is set)',
        ),
    })
    .passthrough(),
};

export type GetMemberInput = z.infer<typeof getMemberSchema.input>;
export type GetMemberOutput = z.infer<typeof getMemberSchema.output>;

export const listBoardMembersSchema = {
  name: 'listBoardMembers',
  description: 'List all members of a board with their board-level role.',
  notes: '',
  input: z.object({
    boardId: BoardIdParam,
    filter: z
      .enum(['admins', 'all', 'normal', 'none', 'owners'])
      .optional()
      .describe(
        "Filter members by board role. 'admins' = board admins only; 'normal' = standard members; 'owners' = workspace owners; 'all' = everyone; 'none' = empty list. Defaults to 'all'.",
      ),
    activity: z
      .boolean()
      .optional()
      .describe(
        'When true, include lastActive timestamp for each member showing when they last interacted with the board.',
      ),
  }),
  output: z.object({
    members: z
      .array(
        z.object({
          id: MemberIdParam,
          username: z.string().describe('Member username'),
          fullName: z.string().describe('Member display name'),
          avatarUrl: z
            .string()
            .nullable()
            .describe('Avatar image URL, or null if not set'),
          initials: z.string().describe('Member initials'),
          memberType: z
            .enum(['admin', 'normal', 'observer'])
            .describe(
              'Board-level role. admin: can change board settings; normal: standard member; observer: view-only access.',
            ),
          lastActive: z
            .string()
            .nullable()
            .optional()
            .describe(
              'ISO 8601 timestamp of last board activity. Only present when activity=true is passed.',
            ),
        }),
      )
      .describe('Members belonging to the board'),
  }),
};

export type ListBoardMembersInput = z.infer<
  typeof listBoardMembersSchema.input
>;
export type ListBoardMembersOutput = z.infer<
  typeof listBoardMembersSchema.output
>;

export const addMemberToCardSchema = {
  name: 'addMemberToCard',
  description: 'Assign a member to a card.',
  notes:
    'The member must already be a member of the board that contains the card.',
  input: z.object({
    dsc: DscParam,
    cardId: CardIdParam,
    memberId: MemberIdParam,
  }),
  output: z.object({
    members: z
      .array(CardMemberSchema)
      .describe(
        'All members currently assigned to the card after the operation',
      ),
  }),
};

export type AddMemberToCardInput = z.infer<typeof addMemberToCardSchema.input>;
export type AddMemberToCardOutput = z.infer<
  typeof addMemberToCardSchema.output
>;

export const removeMemberFromCardSchema = {
  name: 'removeMemberFromCard',
  description: 'Unassign a member from a card.',
  notes:
    'Only removes the assignment on this card; the member remains on the board.',
  input: z.object({
    dsc: DscParam,
    cardId: CardIdParam,
    memberId: MemberIdParam,
  }),
  output: z.object({
    success: z
      .boolean()
      .describe('True if the member was removed from the card successfully'),
  }),
};

export type RemoveMemberFromCardInput = z.infer<
  typeof removeMemberFromCardSchema.input
>;
export type RemoveMemberFromCardOutput = z.infer<
  typeof removeMemberFromCardSchema.output
>;

// ============================================================================
// Domain Schema Array
// ============================================================================

export const membersSchemas = [
  getContextSchema,
  getMeSchema,
  getMemberSchema,
  listBoardMembersSchema,
  addMemberToCardSchema,
  removeMemberFromCardSchema,
];
