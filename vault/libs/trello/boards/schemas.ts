import { z } from 'zod';
import {
  DscParam,
  BoardIdParam,
  BoardSchema,
  OrganizationSchema,
  ListSchema,
  LabelSchema,
  CardSchema,
} from '../params';
import { ChecklistSchema } from '../checklists/schemas';

// ============================================================================
// Entity Schemas
// ============================================================================

export const BoardPrefsSchema = z
  .object({
    permissionLevel: z
      .string()
      .describe('Visibility level: "private", "org", or "public"'),
    voting: z
      .string()
      .describe(
        'Who can vote on cards: "disabled", "members", "observers", "org", "public"',
      ),
    comments: z
      .string()
      .describe(
        'Who can comment: "disabled", "members", "observers", "org", "public"',
      ),
    invitations: z.string().describe('Who can invite: "admins" or "members"'),
    selfJoin: z
      .boolean()
      .describe('Whether any org member can join the board without invitation'),
    cardCovers: z.boolean().describe('Whether card cover images are shown'),
    background: z.string().describe('Board background color name or image ID'),
    backgroundImage: z
      .string()
      .nullable()
      .describe('URL of the board background image, or null for solid colors'),
    backgroundColor: z
      .string()
      .nullable()
      .describe(
        'Hex color of the board background, or null if image background',
      ),
    calendarFeedEnabled: z
      .boolean()
      .describe('Whether the calendar power-up feed is enabled'),
  })
  .passthrough()
  .describe(
    'Board preference settings controlling visibility, voting, and appearance',
  );

export const LabelNamesSchema = z
  .object({
    green: z.string().describe('Name for the green label'),
    yellow: z.string().describe('Name for the yellow label'),
    orange: z.string().describe('Name for the orange label'),
    red: z.string().describe('Name for the red label'),
    purple: z.string().describe('Name for the purple label'),
    blue: z.string().describe('Name for the blue label'),
    sky: z.string().describe('Name for the sky label'),
    lime: z.string().describe('Name for the lime label'),
    pink: z.string().describe('Name for the pink label'),
    black: z.string().describe('Name for the black label'),
  })
  .passthrough()
  .describe('Custom label names for this board, keyed by color');

export const BoardDetailSchema = z.object({
  id: BoardIdParam,
  name: z.string().describe('Board display name'),
  desc: z.string().describe('Board description (may be empty string)'),
  closed: z.boolean().describe('Whether the board is archived'),
  url: z.string().describe('Full URL of the board'),
  shortLink: z
    .string()
    .describe('Short URL identifier used in board URLs (e.g. "JRX8Zj2a")'),
  prefs: BoardPrefsSchema,
  labelNames: LabelNamesSchema,
  idOrganization: z
    .string()
    .nullable()
    .describe(
      'Workspace/organization ID the board belongs to, or null for personal boards',
    ),
});

export const WorkspaceSummarySchema = z
  .object({
    id: z.string().describe('Workspace/organization ID (24-char hex string)'),
    displayName: z.string().describe('Human-readable workspace name'),
    name: z
      .string()
      .describe('URL slug for the workspace (used in workspace URLs)'),
    url: z.string().optional().describe('Full URL of the workspace'),
    logoUrl: z
      .string()
      .nullable()
      .describe('URL of the workspace logo image, or null if unset'),
    desc: z
      .string()
      .optional()
      .describe('Workspace description (may be empty string)'),
    website: z
      .string()
      .nullable()
      .optional()
      .describe('Website URL set on the workspace profile, or null if unset'),
    products: z
      .array(z.number())
      .optional()
      .describe(
        'Product/plan identifiers associated with the workspace (e.g. [110] = Business Class)',
      ),
    premiumFeatures: z
      .array(z.string())
      .optional()
      .describe('List of enabled premium feature identifiers'),
    memberships: z
      .array(
        z
          .object({
            id: z.string().describe('Membership record ID'),
            idMember: z.string().describe('Member ID'),
            memberType: z
              .string()
              .describe('Membership type: "admin", "normal", or "observer"'),
            unconfirmed: z
              .boolean()
              .describe('Whether the membership is unconfirmed'),
            deactivated: z
              .boolean()
              .describe('Whether the member is deactivated'),
          })
          .passthrough(),
      )
      .optional()
      .describe('Membership records for the workspace'),
    idBoards: z
      .array(z.string())
      .optional()
      .describe('IDs of boards in the workspace'),
    membersCount: z
      .number()
      .optional()
      .describe('Total number of members in the workspace'),
    dateLastActivity: z
      .string()
      .nullable()
      .optional()
      .describe('ISO 8601 timestamp of last activity in the workspace'),
    logoHash: z
      .string()
      .nullable()
      .optional()
      .describe('Hash of the workspace logo image, or null if unset'),
    idEnterprise: z
      .string()
      .nullable()
      .optional()
      .describe('Enterprise ID if the workspace belongs to an enterprise'),
    offering: z
      .string()
      .optional()
      .describe(
        'Offering/plan identifier (e.g. "trello.business_class", "trello.standard")',
      ),
  })
  .passthrough();

export const WorkspaceMembershipSchema = z.object({
  id: z.string().describe('Membership record ID'),
  idMember: z.string().describe('Member ID'),
  memberType: z
    .string()
    .describe('Membership type: "admin", "normal", or "observer"'),
  unconfirmed: z.boolean().describe('Whether the membership is unconfirmed'),
  deactivated: z.boolean().describe('Whether the member is deactivated'),
  lastActive: z
    .string()
    .optional()
    .describe(
      "ISO 8601 timestamp of the member's last activity (present when memberships_member=true)",
    ),
  member: z
    .object({
      id: z.string().describe('Member ID'),
      fullName: z.string().describe('Member display name'),
      username: z.string().describe('Member username'),
    })
    .passthrough()
    .optional()
    .describe('Embedded member details (present when memberships_member=true)'),
});

export const WorkspaceDetailSchema = z.object({
  id: z.string().describe('Workspace/organization ID (24-char hex string)'),
  name: z.string().describe('URL slug for the workspace'),
  displayName: z.string().describe('Human-readable workspace name'),
  desc: z.string().describe('Workspace description (may be empty string)'),
  url: z.string().describe('Full URL of the workspace'),
  website: z
    .string()
    .nullable()
    .describe('Website URL set on the workspace profile, or null if unset'),
  logoUrl: z
    .string()
    .nullable()
    .describe('URL of the workspace logo image, or null if unset'),
  memberships: z
    .array(WorkspaceMembershipSchema)
    .describe('All member records for this workspace'),
  premiumFeatures: z
    .array(z.string())
    .describe('List of enabled premium feature identifiers'),
  products: z
    .array(z.number())
    .describe('Product/plan identifiers associated with the workspace'),
});

// ============================================================================
// Function Schemas
// ============================================================================

export const listBoardsSchema = {
  name: 'listBoards',
  description:
    'List all boards for the current member. Returns open boards by default.',
  notes: '',
  input: z.object({
    filter: z
      .enum([
        'open',
        'closed',
        'all',
        'starred',
        'members',
        'organization',
        'public',
        'pinned',
        'unpinned',
      ])
      .optional()
      .describe(
        'Filter boards by status or relationship. Defaults to "open". ' +
          '"starred" = starred boards; "members" = boards where you are a direct member; ' +
          '"organization" = boards belonging to your workspaces; ' +
          '"public" = public boards; "pinned" / "unpinned" = pin state.',
      ),
  }),
  output: z.object({
    boards: z.array(BoardSchema).describe('Boards matching the filter'),
    organizations: z
      .array(OrganizationSchema)
      .describe('Workspaces the current member belongs to'),
  }),
};

export type ListBoardsInput = z.infer<typeof listBoardsSchema.input>;
export type ListBoardsOutput = z.infer<typeof listBoardsSchema.output>;

export const getBoardSchema = {
  name: 'getBoard',
  description:
    'Get full details for a specific board by ID, including preferences, label names, and workspace association. Optionally embed related resources (lists, members, cards, labels, etc.) in a single request.',
  notes: '',
  input: z.object({
    boardId: BoardIdParam,
    lists: z
      .enum(['none', 'open', 'closed', 'all'])
      .optional()
      .describe(
        'Embed lists in the response. "open" returns active lists, "closed" archived lists, "all" all lists.',
      ),
    members: z
      .enum(['none', 'normal', 'admins', 'owners', 'all'])
      .optional()
      .describe(
        'Embed board members in the response. "all" returns all member types.',
      ),
    cards: z
      .enum(['none', 'open', 'closed', 'visible', 'all'])
      .optional()
      .describe(
        'Embed cards in the response. "visible" returns only cards in open lists.',
      ),
    labels: z
      .enum(['none', 'all'])
      .optional()
      .describe('Embed board labels in the response.'),
    organization: z
      .boolean()
      .optional()
      .describe('Embed the workspace/organization object in the response.'),
    checklists: z
      .enum(['none', 'all'])
      .optional()
      .describe(
        'Embed checklists (with checkItems) in the response. Only meaningful when cards are also embedded.',
      ),
    myPrefs: z
      .boolean()
      .optional()
      .describe(
        "Embed the current member's board preferences (sidebar settings, email key, AI integration flags, etc.).",
      ),
    pluginData: z
      .boolean()
      .optional()
      .describe('Embed Power-Up plugin data associated with the board.'),
    boardStars: z
      .enum(['none', 'mine'])
      .optional()
      .describe(
        'Embed board star records. "mine" returns star record for the current member (empty array if not starred).',
      ),
    actions: z
      .string()
      .optional()
      .describe(
        'Embed board actions. Pass "all" for all types, or a comma-separated list of action types (e.g. "createCard,commentCard").',
      ),
    actions_limit: z
      .number()
      .optional()
      .describe(
        'Maximum number of actions to embed when actions param is set. Defaults to 50.',
      ),
  }),
  output: z.object({
    board: BoardDetailSchema.extend({
      lists: z
        .array(ListSchema)
        .optional()
        .describe('Embedded lists (present when lists param is set)'),
      members: z
        .array(
          z
            .object({
              id: z.string().describe('Member ID'),
              username: z.string().describe('Member username'),
              fullName: z.string().describe('Member display name'),
            })
            .passthrough(),
        )
        .optional()
        .describe('Embedded board members (present when members param is set)'),
      cards: z
        .array(CardSchema)
        .optional()
        .describe('Embedded cards (present when cards param is set)'),
      labels: z
        .array(LabelSchema)
        .optional()
        .describe('Embedded board labels (present when labels param is set)'),
      checklists: z
        .array(ChecklistSchema)
        .optional()
        .describe(
          'Embedded checklists with checkItems (present when checklists="all"). Contains all checklists across all cards on the board.',
        ),
      organization: z
        .object({
          id: z.string().describe('Organization ID'),
          displayName: z.string().describe('Human-readable workspace name'),
          name: z.string().describe('URL slug for the workspace'),
        })
        .passthrough()
        .optional()
        .describe(
          'Embedded organization/workspace object (present when organization=true)',
        ),
      myPrefs: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          "Current member's board preferences including sidebar settings, email key, and AI integration flags (present when myPrefs=true)",
        ),
      pluginData: z
        .array(z.object({ id: z.string(), idPlugin: z.string() }).passthrough())
        .optional()
        .describe(
          'Power-Up plugin data for the board (present when pluginData=true)',
        ),
      boardStars: z
        .array(z.object({ id: z.string() }).passthrough())
        .optional()
        .describe(
          'Board star records for the current member (present when boardStars="mine")',
        ),
      actions: z
        .array(
          z
            .object({
              id: z.string().describe('Action ID'),
              type: z.string().describe('Action type'),
              date: z.string().describe('Action date as ISO 8601 string'),
            })
            .passthrough(),
        )
        .optional()
        .describe('Embedded board actions (present when actions param is set)'),
    }).describe('Full board details with optionally embedded resources'),
  }),
};

export type GetBoardInput = z.infer<typeof getBoardSchema.input>;
export type GetBoardOutput = z.infer<typeof getBoardSchema.output>;

export const createBoardSchema = {
  name: 'createBoard',
  description: 'Create a new Trello board.',
  notes: '',
  input: z.object({
    dsc: DscParam,
    name: z.string().describe('Board display name (required)'),
    desc: z.string().optional().describe('Board description'),
    idOrganization: z
      .string()
      .optional()
      .describe(
        'Workspace/organization ID to create the board in. If omitted, the board is created as a personal board.',
      ),
    defaultLists: z
      .boolean()
      .optional()
      .describe(
        'Whether to create default To Do / Doing / Done lists. Defaults to true. Pass false for a blank board.',
      ),
    prefs_permissionLevel: z
      .enum(['private', 'org', 'public'])
      .optional()
      .describe(
        'Board visibility. "private" = invite-only, "org" = workspace members, "public" = anyone. Defaults to "private".',
      ),
    prefs_background: z
      .string()
      .optional()
      .describe(
        'Solid color or gradient background name (e.g. "gradient-snow", "gradient-crystal"). Use this OR prefs_background_url, not both.',
      ),
    prefs_background_url: z
      .string()
      .optional()
      .describe(
        'Unsplash image URL to use as the board background. Use this OR prefs_background, not both.',
      ),
    prefs_selfJoin: z
      .boolean()
      .optional()
      .describe(
        'Whether any workspace member can join the board without an invitation. Defaults to false.',
      ),
  }),
  output: z.object({
    board: z
      .object({
        id: BoardIdParam,
        name: z.string().describe('Board display name'),
        desc: z.string().describe('Board description'),
        closed: z.boolean().describe('Whether the board is archived'),
        shortLink: z.string().describe('Short URL identifier'),
        url: z.string().describe('Full URL of the board'),
        idOrganization: z
          .string()
          .nullable()
          .describe('Workspace ID the board was created in'),
      })
      .describe('The newly created board'),
  }),
};

export type CreateBoardInput = z.infer<typeof createBoardSchema.input>;
export type CreateBoardOutput = z.infer<typeof createBoardSchema.output>;

export const updateBoardSchema = {
  name: 'updateBoard',
  description:
    'Update board properties. Pass only the fields you want to change.',
  notes: '',
  input: z.object({
    dsc: DscParam,
    boardId: BoardIdParam,
    name: z.string().optional().describe('New board display name'),
    desc: z.string().optional().describe('New board description'),
    closed: z
      .boolean()
      .optional()
      .describe('Set to true to archive the board, false to unarchive'),
    subscribed: z
      .boolean()
      .optional()
      .describe(
        'Whether the current member is watching/subscribed to this board. Corresponds to the Watch toggle in the board menu.',
      ),
    prefs: z
      .object({
        permissionLevel: z
          .enum(['private', 'org', 'public'])
          .optional()
          .describe('Board visibility: "private", "org", or "public"'),
        selfJoin: z
          .boolean()
          .optional()
          .describe(
            'Whether any workspace member can join without an invitation',
          ),
        cardCovers: z
          .boolean()
          .optional()
          .describe('Whether to show card cover images on card fronts'),
        background: z
          .string()
          .optional()
          .describe('Board background color name (e.g. "blue") or image ID'),
        voting: z
          .enum(['disabled', 'members', 'observers', 'org', 'public'])
          .optional()
          .describe('Who can vote on cards'),
        comments: z
          .enum(['disabled', 'members', 'observers', 'org', 'public'])
          .optional()
          .describe('Who can add comments'),
        invitations: z
          .enum(['admins', 'members'])
          .optional()
          .describe('Who can invite people to the board'),
        hideVotes: z
          .boolean()
          .optional()
          .describe('Whether to hide vote counts from non-admin board members'),
        showCompleteStatus: z
          .boolean()
          .optional()
          .describe(
            'Whether to show the complete status indicator on card fronts when a card has a due date marked complete',
          ),
        cardCounts: z
          .boolean()
          .optional()
          .describe(
            'Whether to show a card count badge on each list header indicating the number of cards in the list',
          ),
        isTemplate: z
          .boolean()
          .optional()
          .describe(
            'Whether this board is a template. Template boards appear in the "Create board from template" flow.',
          ),
        cardAging: z
          .enum(['regular', 'pirate'])
          .optional()
          .describe(
            'Card aging visual style. "regular" fades cards over time; "pirate" applies a torn-paper effect. Requires the Card Aging Power-Up.',
          ),
        calendarFeedEnabled: z
          .boolean()
          .optional()
          .describe(
            "Whether the board's iCal calendar feed is enabled, allowing cards with due dates to appear in external calendar applications",
          ),
      })
      .optional()
      .describe(
        'Board preference fields to update. Only specified sub-fields are changed.',
      ),
  }),
  output: z.object({
    board: z
      .object({
        id: BoardIdParam,
        name: z.string().describe('Board display name'),
        desc: z.string().describe('Board description'),
        closed: z.boolean().describe('Whether the board is archived'),
        shortLink: z.string().describe('Short URL identifier'),
        url: z.string().describe('Full URL of the board'),
        idOrganization: z
          .string()
          .nullable()
          .describe('Workspace ID the board belongs to'),
      })
      .describe('The updated board'),
  }),
};

export type UpdateBoardInput = z.infer<typeof updateBoardSchema.input>;
export type UpdateBoardOutput = z.infer<typeof updateBoardSchema.output>;

export const closeBoardSchema = {
  name: 'closeBoard',
  description:
    'Archive a board by setting closed=true. Archived boards are hidden from the default board list but not deleted and can be unarchived.',
  notes: '',
  input: z.object({
    dsc: DscParam,
    boardId: BoardIdParam,
    subscribed: z
      .boolean()
      .optional()
      .describe(
        'Whether the current member is subscribed to the board for notifications. Pass false to unsubscribe when archiving.',
      ),
  }),
  output: z.object({
    success: z
      .boolean()
      .describe('True if the board was archived successfully'),
  }),
};

export type CloseBoardInput = z.infer<typeof closeBoardSchema.input>;
export type CloseBoardOutput = z.infer<typeof closeBoardSchema.output>;

export const deleteBoardSchema = {
  name: 'deleteBoard',
  description:
    'Permanently delete a board and all its lists, cards, and data. This action is irreversible.',
  notes:
    'Use closeBoard (archive) if you want a recoverable operation. Deletion is permanent; there is no recovery path.',
  input: z.object({
    dsc: DscParam,
    boardId: BoardIdParam,
  }),
  output: z.object({
    success: z.boolean().describe('True if the board was deleted successfully'),
  }),
};

export type DeleteBoardInput = z.infer<typeof deleteBoardSchema.input>;
export type DeleteBoardOutput = z.infer<typeof deleteBoardSchema.output>;

export const listWorkspacesSchema = {
  name: 'listWorkspaces',
  description:
    'List all workspaces (organizations) the current member belongs to.',
  notes: '',
  input: z.object({
    organizations: z
      .enum(['all', 'members', 'public', 'none'])
      .optional()
      .describe(
        'Which organizations to include. "all" returns all orgs the member belongs to (default), ' +
          '"members" returns orgs where the member has an explicit membership record, ' +
          '"public" returns public orgs only, "none" returns an empty list.',
      ),
    organization_fields: z
      .string()
      .optional()
      .describe(
        'Comma-separated list of fields to include in each workspace object. ' +
          'Default fields: id, displayName, name, url, logoUrl. ' +
          'Additional fields: desc, website, products, premiumFeatures. ' +
          'Example: "id,displayName,name,url,logoUrl,desc,website,products,premiumFeatures".',
      ),
    organizationsInvited: z
      .enum(['all', 'members', 'public', 'none'])
      .optional()
      .describe(
        'Include workspaces the member has been invited to but not yet joined. ' +
          '"all" returns all such invitations, "none" suppresses this field.',
      ),
    organizationsInvited_fields: z
      .string()
      .optional()
      .describe(
        'Comma-separated list of fields to include in each invited workspace object. ' +
          'Only meaningful when organizationsInvited is set. ' +
          'Accepts same field names as organization_fields.',
      ),
  }),
  output: z.object({
    workspaces: z
      .array(WorkspaceSummarySchema)
      .describe('All workspaces the current member belongs to'),
    workspacesInvited: z
      .array(WorkspaceSummarySchema)
      .optional()
      .describe(
        'Workspaces the member has been invited to but not yet joined (present when organizationsInvited is set)',
      ),
  }),
};

export type ListWorkspacesInput = z.infer<typeof listWorkspacesSchema.input>;
export type ListWorkspacesOutput = z.infer<typeof listWorkspacesSchema.output>;

export const getWorkspaceSchema = {
  name: 'getWorkspace',
  description:
    'Get full details for a specific workspace (organization) by ID, including membership list and plan information.',
  notes: '',
  input: z.object({
    workspaceId: z
      .string()
      .describe(
        'Workspace/organization ID (24-char hex string or URL slug, e.g. "myteamworkspace")',
      ),
    boards: z
      .enum(['open', 'closed', 'all', 'members', 'public', 'starred'])
      .optional()
      .describe(
        'Embed boards in the response. "open" returns active boards, "closed" archived, "all" both, ' +
          '"members" boards where you are a direct member, "public" publicly visible boards, "starred" starred boards.',
      ),
    board_fields: z
      .string()
      .optional()
      .describe(
        'Comma-separated list of fields to include in each embedded board (e.g. "id,name,shortLink,closed"). ' +
          'Only meaningful when boards param is set.',
      ),
    members: z
      .enum(['none', 'all', 'admins', 'owners', 'normal'])
      .optional()
      .describe(
        'Embed member objects in the response. "all" returns all members, "admins" only admins, ' +
          '"owners" only owners, "normal" non-admin members, "none" suppresses the field.',
      ),
    member_fields: z
      .string()
      .optional()
      .describe(
        'Comma-separated list of fields to include in each embedded member (e.g. "id,fullName,username,avatarUrl"). ' +
          'Only meaningful when members param is set.',
      ),
    memberships_member: z
      .boolean()
      .optional()
      .describe(
        'When true, embeds a member object inside each membership record. ' +
          'Useful for resolving member details without a separate members request.',
      ),
    memberships_member_fields: z
      .string()
      .optional()
      .describe(
        'Comma-separated list of fields to include in the member object embedded in each membership ' +
          '(e.g. "id,fullName,username"). Only meaningful when memberships_member=true.',
      ),
    paid_account: z
      .boolean()
      .optional()
      .describe(
        'When true, embeds a paidAccount object with billing details: plan product, expiry date, ' +
          'subscription standing, contact info, and billing dates.',
      ),
    tags: z
      .boolean()
      .optional()
      .describe(
        'When true, embeds a tags array on the workspace. Returns an empty array if no tags are set.',
      ),
  }),
  output: z.object({
    workspace: WorkspaceDetailSchema.extend({
      boards: z
        .array(z.object({ id: z.string(), name: z.string() }).passthrough())
        .optional()
        .describe('Embedded boards (present when boards param is set)'),
      members: z
        .array(
          z
            .object({
              id: z.string().describe('Member ID'),
              fullName: z.string().describe('Member display name'),
              username: z.string().describe('Member username'),
            })
            .passthrough(),
        )
        .optional()
        .describe(
          'Embedded member objects (present when members param is set)',
        ),
      paidAccount: z
        .object({
          autoRenew: z
            .boolean()
            .describe('Whether the subscription auto-renews'),
          expiresAt: z
            .string()
            .nullable()
            .describe('Subscription expiry date as ISO 8601 string'),
          product: z.number().describe('Primary plan product identifier'),
          products: z
            .array(z.number())
            .describe('All plan product identifiers'),
          standing: z.number().describe('Account standing score (0-3)'),
          needsCreditCardUpdate: z
            .boolean()
            .describe('Whether a new credit card is needed'),
          contactEmail: z
            .string()
            .nullable()
            .describe('Billing contact email address'),
          contactFullName: z
            .string()
            .nullable()
            .describe('Billing contact full name'),
          userCountBilledThisPeriod: z
            .number()
            .describe('Number of seats billed this billing period'),
        })
        .passthrough()
        .nullable()
        .optional()
        .describe(
          'Billing and subscription details (present when paid_account=true). ' +
            'null when the workspace has no paid subscription.',
        ),
      tags: z
        .array(z.unknown())
        .optional()
        .describe(
          'Workspace tags (present when tags=true). Empty array if no tags are set.',
        ),
    }).describe('Full workspace details'),
  }),
};

export type GetWorkspaceInput = z.infer<typeof getWorkspaceSchema.input>;
export type GetWorkspaceOutput = z.infer<typeof getWorkspaceSchema.output>;

// ============================================================================
// Domain Schema Array
// ============================================================================

export const boardsSchemas = [
  listBoardsSchema,
  getBoardSchema,
  createBoardSchema,
  updateBoardSchema,
  closeBoardSchema,
  deleteBoardSchema,
  listWorkspacesSchema,
  getWorkspaceSchema,
];
