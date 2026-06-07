import { z } from 'zod';

export const libraryDescription = 'Notion operations via API';

export const libraryIcon = '/icons/libs/notion.png';
export const loginUrl = 'https://www.notion.so';

export const libraryNotes = `
## Workflow

1. Navigate to any Notion workspace page
2. Call \`listWorkspaces\` to see available workspaces
3. **Confirm with the user which workspace to use** if multiple are available
4. Call \`getContext\` with the chosen \`workspaceName\` (or convenience functions which auto-detect)
5. Call functions directly (auth via browser cookies)

## Important
Always confirm the target workspace with the user before searching or reading pages. Users often have multiple workspaces (personal + team).

## Teamspaces

Workspaces are organized into teamspaces (visible to all members) and a Private section (visible only to you). Call \`listTeamspaces\` to discover available teamspaces before creating pages. Use the \`teamspace\` param on \`createPage\` to create at the root of a teamspace or in Private. Pass \`"Private"\` to create a page only you can see.

## Reading Content

| Goal | Function |
|------|----------|
| List workspaces | \`listWorkspaces\` |
| List teamspaces in a workspace | \`listTeamspaces\` |
| Browse recent pages | \`listRecentPages\` |
| Search by title or content | \`quickSearch\` |
| Read full page | \`getPageAsText\` |

## Writing Content

| Goal | Function |
|------|----------|
| Create page under a parent page | \`createPage\` with \`parent_id\` |
| Create page at teamspace root | \`createPage\` with \`teamspace\` name |
| Create private page | \`createPage\` with \`teamspace: "Private"\` |
| Update page title/icon | \`updatePage\` |
| Delete page | \`archivePage\` |
| Restore from trash | \`restorePage\` |
| Add text/headings/lists to a page | \`appendBlocks\` |
| Remove a block | \`deleteBlock\` |

## Databases

| Goal | Function |
|------|----------|
| Create database with columns | \`createDatabase\` |
| View database columns | \`getDatabaseSchema\` |
| List database rows | \`queryDatabase\` |
| Add row | \`addDatabaseRow\` |
| Update row | \`updateDatabaseRow\` |
| Add column | \`addDatabaseProperty\` |
| Remove column | \`removeDatabaseProperty\` |

## Sharing & Permissions

| Goal | Function |
|------|----------|
| Share a page with someone by email | \`sharePage\` |
| Change or remove someone's access | \`updatePagePermission\` |
| Get current share settings | \`getPagePermissions\` |
| Publish/unpublish page to web | \`publishToWeb\` |
| Get shareable link (copy link) | \`getPageLink\` |

## Database IDs
Use the page ID from the URL for database operations (the \`database_id\` parameter). This is the \`collection_view_page\` block ID, not the internal collection ID.

## Valid URLs

| URL Pattern | Valid |
|-------------|-------|
| \`notion.so/workspace/Page-Name-abc123...\` | Yes |
| \`notion.so/abc123def456...\` | Yes |
| \`notion.so\` (homepage) | No |
| \`notion.so/product\` (marketing) | No |
`;

// ============================================================================
// Shared Parameter Schemas
// ============================================================================

export const TokenParam = z
  .string()
  .describe('Notion API token from getContext');

const uuidRegex =
  /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

export const PageIdParam = z
  .string()
  .regex(uuidRegex)
  .describe(
    'Page ID (UUID format, e.g., "12345678-1234-1234-1234-123456789abc")',
  );

export const DatabaseIdParam = z
  .string()
  .regex(uuidRegex)
  .describe('Database ID (UUID format)');

export const BlockIdParam = z
  .string()
  .regex(uuidRegex)
  .describe('Block ID (UUID format)');

export const UserIdParam = z
  .string()
  .regex(uuidRegex)
  .describe('User ID (UUID format)');

export const CursorParam = z
  .string()
  .optional()
  .describe('Pagination cursor for next page');

export const PageSizeParam = z
  .number()
  .int()
  .min(1)
  .max(100)
  .optional()
  .describe('Number of items to return (default 100, max 100)');

// ============================================================================
// Rich Text Schema
// ============================================================================

export const AnnotationsSchema = z.object({
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  strikethrough: z.boolean().optional(),
  underline: z.boolean().optional(),
  code: z.boolean().optional(),
  color: z
    .enum([
      'default',
      'gray',
      'brown',
      'orange',
      'yellow',
      'green',
      'blue',
      'purple',
      'pink',
      'red',
      'gray_background',
      'brown_background',
      'orange_background',
      'yellow_background',
      'green_background',
      'blue_background',
      'purple_background',
      'pink_background',
      'red_background',
    ])
    .optional(),
});

export const RichTextSchema = z.object({
  type: z.enum(['text', 'mention', 'equation']),
  text: z
    .object({
      content: z.string(),
      link: z.object({ url: z.string() }).nullable().optional(),
    })
    .optional(),
  mention: z
    .object({
      type: z.enum(['user', 'page', 'database', 'date', 'link_preview']),
    })
    .optional(),
  equation: z.object({ expression: z.string() }).optional(),
  annotations: AnnotationsSchema.optional(),
  plain_text: z.string().optional(),
  href: z.string().nullable().optional(),
});

// ============================================================================
// Parent Schema
// ============================================================================

export const ParentSchema = z.object({
  type: z.enum(['page_id', 'database_id', 'workspace', 'block_id']),
  page_id: z.string().optional(),
  database_id: z.string().optional(),
  workspace: z.boolean().optional(),
  block_id: z.string().optional(),
});

// ============================================================================
// User Schema
// ============================================================================

export const UserSchema = z.object({
  object: z.literal('user'),
  id: UserIdParam,
  type: z.enum(['person', 'bot']).optional(),
  name: z.string().nullable().optional(),
  avatar_url: z.string().nullable().optional(),
  person: z
    .object({
      email: z.string().optional(),
    })
    .optional(),
  bot: z
    .object({
      owner: z
        .object({
          type: z.enum(['workspace', 'user']),
          workspace: z.boolean().optional(),
          user: z.unknown().optional(),
        })
        .optional(),
      workspace_name: z.string().optional(),
    })
    .optional(),
});

// ============================================================================
// Page Schema
// ============================================================================

export const PageSchema = z.object({
  object: z.literal('page'),
  id: PageIdParam,
  created_time: z.string().describe('ISO 8601 timestamp'),
  created_by: z.object({ object: z.literal('user'), id: z.string() }),
  last_edited_time: z.string().describe('ISO 8601 timestamp'),
  last_edited_by: z.object({ object: z.literal('user'), id: z.string() }),
  archived: z.boolean(),
  in_trash: z.boolean().optional(),
  icon: z
    .union([
      z.object({ type: z.literal('emoji'), emoji: z.string() }),
      z.object({
        type: z.literal('external'),
        external: z.object({ url: z.string() }),
      }),
      z.object({
        type: z.literal('file'),
        file: z.object({ url: z.string() }),
      }),
    ])
    .nullable()
    .optional(),
  cover: z
    .object({
      type: z.enum(['external', 'file']),
      external: z.object({ url: z.string() }).optional(),
      file: z.object({ url: z.string() }).optional(),
    })
    .nullable()
    .optional(),
  properties: z.record(z.string(), z.unknown()).describe('Page properties'),
  parent: ParentSchema,
  url: z.string(),
  public_url: z.string().nullable().optional(),
});

// ============================================================================
// Database Schema
// ============================================================================

export const DatabaseSchema = z.object({
  object: z.literal('database'),
  id: DatabaseIdParam,
  created_time: z.string().describe('ISO 8601 timestamp'),
  created_by: z.object({ object: z.literal('user'), id: z.string() }),
  last_edited_time: z.string().describe('ISO 8601 timestamp'),
  last_edited_by: z.object({ object: z.literal('user'), id: z.string() }),
  title: z.array(RichTextSchema),
  description: z.array(RichTextSchema).optional(),
  icon: z.unknown().nullable().optional(),
  cover: z.unknown().nullable().optional(),
  properties: z
    .record(z.string(), z.unknown())
    .describe('Database schema properties'),
  parent: ParentSchema,
  url: z.string(),
  public_url: z.string().nullable().optional(),
  archived: z.boolean(),
  in_trash: z.boolean().optional(),
  is_inline: z.boolean(),
});

// ============================================================================
// Block Schema
// ============================================================================

export const BlockSchema = z.object({
  object: z.literal('block'),
  id: BlockIdParam,
  parent: ParentSchema.optional(),
  type: z
    .string()
    .describe('Block type (paragraph, heading_1, bulleted_list_item, etc.)'),
  created_time: z.string().optional(),
  created_by: z
    .object({ object: z.literal('user'), id: z.string() })
    .optional(),
  last_edited_time: z.string().optional(),
  last_edited_by: z
    .object({ object: z.literal('user'), id: z.string() })
    .optional(),
  archived: z.boolean().optional(),
  in_trash: z.boolean().optional(),
  has_children: z.boolean(),
});

// ============================================================================
// Comment Schema
// ============================================================================

export const CommentSchema = z.object({
  object: z.literal('comment'),
  id: z.string().regex(uuidRegex),
  parent: z.union([
    z.object({ type: z.literal('page_id'), page_id: z.string() }),
    z.object({ type: z.literal('block_id'), block_id: z.string() }),
  ]),
  discussion_id: z.string().regex(uuidRegex),
  rich_text: z.array(RichTextSchema),
  created_by: z.object({ object: z.literal('user'), id: z.string() }),
  created_time: z.string(),
});

// ============================================================================
// Context Schema
// ============================================================================

export const NotionContextSchema = z.object({
  userId: z.string().describe('Current user ID'),
  spaceId: z.string().describe('Current workspace/space ID'),
});

// ============================================================================
// Action Schemas - Workspaces
// ============================================================================

export const listWorkspacesSchema = {
  name: 'listWorkspaces',
  description: 'List all Notion workspaces accessible to the current user',
  notes:
    'Call this first to discover available workspaces before searching or browsing.',
  input: z.object({
    timeoutMs: z
      .number()
      .optional()
      .default(10000)
      .describe('Max wait time in milliseconds'),
  }),
  output: z.object({
    workspaces: z.array(
      z.object({
        id: z.string().describe('Workspace/space ID'),
        name: z.string().describe('Workspace name'),
      }),
    ),
  }),
};

export const listTeamspacesSchema = {
  name: 'listTeamspaces',
  description:
    'List all teamspaces in a workspace, including the Private section',
  notes:
    'Call this before createPage when the user wants to create a page at the root of a teamspace or in their private section. ' +
    'Returns a special entry with name "Private" and is_private_section=true for the user\'s private section.',
  input: z.object({
    workspaceName: z
      .string()
      .optional()
      .describe('Workspace name to connect to'),
  }),
  output: z.object({
    teamspaces: z.array(
      z.object({
        id: z
          .string()
          .describe('Teamspace ID, or "private" for Private section'),
        name: z
          .string()
          .describe(
            'Teamspace name (e.g. "Founders", "Northlight AI HQ", "Private")',
          ),
        description: z.string().describe('Teamspace description'),
        icon: z.string().nullable().describe('Icon path or null'),
        is_default: z
          .boolean()
          .describe('Whether this is the default teamspace'),
        page_count: z
          .number()
          .describe('Number of top-level pages in this teamspace'),
        is_private_section: z
          .boolean()
          .describe('True only for the Private section entry'),
      }),
    ),
  }),
};

// ============================================================================
// Action Schemas - Context
// ============================================================================

export const getContextSchema = {
  name: 'getContext',
  description:
    'Extract Notion context (userId, spaceId) from current browser session',
  notes:
    'Navigate to any Notion page first. Call listWorkspaces to see available workspaces, then pass workspaceName to connect to the right one.',
  input: z.object({
    timeoutMs: z
      .number()
      .optional()
      .default(10000)
      .describe('Max wait time in milliseconds (default: 10000)'),
    workspaceName: z
      .string()
      .optional()
      .describe(
        'Workspace name to connect to. Use listWorkspaces to see available options.',
      ),
  }),
  output: NotionContextSchema,
};

// ============================================================================
// Action Schemas - Workspace Details & Subscription
// ============================================================================

export const getWorkspaceDetailsSchema = {
  name: 'getWorkspaceDetails',
  description:
    'Get detailed information about a workspace including plan, features, and settings',
  notes: '',
  input: z.object({
    workspaceName: z
      .string()
      .optional()
      .describe(
        'Workspace name to connect to. Use listWorkspaces to see available options.',
      ),
    timeoutMs: z
      .number()
      .optional()
      .default(10000)
      .describe('Max wait time in milliseconds'),
  }),
  output: z.object({
    id: z.string().describe('Workspace/space ID'),
    name: z.string().describe('Workspace name'),
    icon: z.string().nullable().describe('Icon URL or path, or null'),
    plan_type: z.string().describe('Plan type (e.g. "team", "personal")'),
    subscription_tier: z
      .string()
      .describe('Subscription tier (e.g. "plus", "free", "student")'),
    created_time: z.string().describe('ISO 8601 creation timestamp'),
    invite_link_enabled: z.boolean(),
    disable_guests: z.boolean(),
    disable_export: z.boolean(),
    disable_public_access: z.boolean(),
    ai_enabled: z.boolean().describe('Whether AI features are enabled'),
    teams_enabled: z.boolean().describe('Whether Teams features are enabled'),
    membership_type: z
      .string()
      .describe(
        'Current user\'s role in the workspace (e.g. "owner", "member", "guest", "none")',
      ),
  }),
};

export const getSubscriptionSchema = {
  name: 'getSubscription',
  description: 'Get subscription and billing information for a workspace',
  notes:
    'Only workspace admins/owners see full billing details. Guests see limited info (tier and type only).',
  input: z.object({
    workspaceName: z
      .string()
      .optional()
      .describe(
        'Workspace name to connect to. Use listWorkspaces to see available options.',
      ),
    timeoutMs: z
      .number()
      .optional()
      .default(10000)
      .describe('Max wait time in milliseconds'),
  }),
  output: z.object({
    type: z
      .string()
      .describe(
        'Subscription type (e.g. "subscribed_admin", "unsubscribed_admin", "subscribed_guest")',
      ),
    subscription_tier: z
      .string()
      .describe('Subscription tier (e.g. "plus", "free", "student")'),
    is_subscribed: z.boolean(),
    has_paid: z.boolean(),
    plan: z
      .string()
      .nullable()
      .describe(
        'Stripe plan name (e.g. "plus_monthly_usd_202407") or null for free',
      ),
    account_balance: z.number().describe('Stripe account balance in cents'),
    add_ons: z.array(z.string()).describe('Active add-on identifiers'),
  }),
};

// ============================================================================
// Action Schemas - Users
// ============================================================================

export const getMeSchema = {
  name: 'getMe',
  description: 'Get the current bot user',
  notes: '',
  input: z.object({
    token: TokenParam,
  }),
  output: z.object({
    object: z.literal('user'),
    id: UserIdParam,
    type: z.literal('bot'),
    name: z.string().nullable(),
    avatar_url: z.string().nullable(),
    bot: z.object({
      owner: z.object({
        type: z.enum(['workspace', 'user']),
        workspace: z.boolean().optional(),
      }),
      workspace_name: z.string().optional(),
    }),
  }),
};

export const usersListSchema = {
  name: 'usersList',
  description: 'List all users in the workspace',
  notes: '',
  input: z.object({
    token: TokenParam,
    start_cursor: CursorParam,
    page_size: PageSizeParam,
  }),
  output: z.object({
    object: z.literal('list'),
    results: z.array(UserSchema),
    next_cursor: z.string().nullable(),
    has_more: z.boolean(),
  }),
};

export const usersGetSchema = {
  name: 'usersGet',
  description: 'Get a user by ID',
  notes: '',
  input: z.object({
    token: TokenParam,
    user_id: UserIdParam,
  }),
  output: UserSchema,
};

// ============================================================================
// Action Schemas - Pages
// ============================================================================

export const pagesCreateSchema = {
  name: 'pagesCreate',
  description: 'Create a new page',
  notes:
    '**DESTRUCTIVE**: Creates a new page as a child of a page or database. ' +
    'Provide parent and properties. For database children, properties must match the database schema.',
  input: z.object({
    token: TokenParam,
    parent: z.union([
      z.object({ page_id: PageIdParam }),
      z.object({ database_id: DatabaseIdParam }),
    ]),
    properties: z.record(z.string(), z.unknown()).describe('Page properties'),
    children: z.array(z.unknown()).optional().describe('Initial block content'),
    icon: z.unknown().optional(),
    cover: z.unknown().optional(),
  }),
  output: PageSchema,
};

export const pagesRetrieveSchema = {
  name: 'pagesRetrieve',
  description: 'Retrieve a page by ID',
  notes:
    'Returns page properties, not page content. Use blocksChildren for content.',
  input: z.object({
    token: TokenParam,
    page_id: PageIdParam,
  }),
  output: PageSchema,
};

export const pagesUpdateSchema = {
  name: 'pagesUpdate',
  description: 'Update page properties',
  notes:
    '**DESTRUCTIVE**: Updates page properties. Cannot update page content (use blocks endpoints).',
  input: z.object({
    token: TokenParam,
    page_id: PageIdParam,
    properties: z.record(z.string(), z.unknown()).optional(),
    icon: z.unknown().optional(),
    cover: z.unknown().optional(),
    archived: z
      .boolean()
      .optional()
      .describe('Set to true to archive the page'),
  }),
  output: PageSchema,
};

export const pagesArchiveSchema = {
  name: 'pagesArchive',
  description: 'Archive a page (destructive)',
  notes: '',
  input: z.object({
    token: TokenParam,
    page_id: PageIdParam,
  }),
  output: PageSchema,
};

export const pagePropertyRetrieveSchema = {
  name: 'pagePropertyRetrieve',
  description: 'Retrieve a specific page property',
  notes:
    'Use for properties with more than 25 references. ' +
    'Returns paginated results for rollups, relations, and rich text with many items.',
  input: z.object({
    token: TokenParam,
    page_id: PageIdParam,
    property_id: z.string().describe('Property ID from database schema'),
    start_cursor: CursorParam,
    page_size: PageSizeParam,
  }),
  output: z.object({
    object: z.enum(['property_item', 'list']),
    results: z.array(z.unknown()).optional(),
    next_cursor: z.string().nullable().optional(),
    has_more: z.boolean().optional(),
  }),
};

export const pagesMoveSchema = {
  name: 'pagesMove',
  description: 'Move a page to a new parent',
  notes:
    '**DESTRUCTIVE**: Moves a page to a different parent page or database. ' +
    'Cannot move databases, only regular pages.',
  input: z.object({
    token: TokenParam,
    page_id: PageIdParam,
    parent: z.union([
      z.object({ type: z.literal('page_id'), page_id: PageIdParam }),
      z.object({
        type: z.literal('data_source_id'),
        data_source_id: z.string().regex(uuidRegex),
      }),
    ]),
  }),
  output: PageSchema,
};

// ============================================================================
// Action Schemas - Databases
// ============================================================================

export const databasesCreateSchema = {
  name: 'databasesCreate',
  description: 'Create a new database',
  notes:
    '**DESTRUCTIVE**: Creates a database as a subpage of the specified parent. ' +
    'Parent must be a page. Status properties cannot be created via API.',
  input: z.object({
    token: TokenParam,
    parent: z.object({ page_id: PageIdParam }),
    title: z.array(RichTextSchema).describe('Database title'),
    properties: z
      .record(z.string(), z.unknown())
      .describe('Database schema properties'),
    icon: z.unknown().optional(),
    cover: z.unknown().optional(),
    is_inline: z.boolean().optional().default(false),
  }),
  output: DatabaseSchema,
};

export const databasesRetrieveSchema = {
  name: 'databasesRetrieve',
  description: 'Retrieve a database by ID',
  notes: 'Returns database metadata and schema, not database rows.',
  input: z.object({
    token: TokenParam,
    database_id: DatabaseIdParam,
  }),
  output: DatabaseSchema,
};

export const databasesUpdateSchema = {
  name: 'databasesUpdate',
  description: 'Update database properties (destructive)',
  notes: '',
  input: z.object({
    token: TokenParam,
    database_id: DatabaseIdParam,
    title: z.array(RichTextSchema).optional(),
    description: z.array(RichTextSchema).optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
    icon: z.unknown().optional(),
    cover: z.unknown().optional(),
    archived: z.boolean().optional(),
  }),
  output: DatabaseSchema,
};

export const databasesQuerySchema = {
  name: 'databasesQuery',
  description: 'Query a database',
  notes:
    'Returns pages in the database matching the filter and sort. ' +
    'Filter and sort use Notion query syntax.',
  input: z.object({
    token: TokenParam,
    database_id: DatabaseIdParam,
    filter: z
      .unknown()
      .optional()
      .describe('Filter object per Notion query syntax'),
    sorts: z
      .array(z.unknown())
      .optional()
      .describe('Sort array per Notion query syntax'),
    start_cursor: CursorParam,
    page_size: PageSizeParam,
  }),
  output: z.object({
    object: z.literal('list'),
    results: z.array(PageSchema),
    next_cursor: z.string().nullable(),
    has_more: z.boolean(),
  }),
};

// ============================================================================
// Action Schemas - Blocks
// ============================================================================

export const blocksRetrieveSchema = {
  name: 'blocksRetrieve',
  description: 'Retrieve a block by ID',
  notes: 'Returns block metadata. Use blocksChildren for nested content.',
  input: z.object({
    token: TokenParam,
    block_id: BlockIdParam,
  }),
  output: BlockSchema,
};

export const blocksUpdateSchema = {
  name: 'blocksUpdate',
  description: 'Update a block',
  notes:
    '**DESTRUCTIVE**: Updates block content. Block type cannot be changed.',
  input: z.object({
    token: TokenParam,
    block_id: BlockIdParam,
    // Block-type-specific content
    paragraph: z.object({ rich_text: z.array(RichTextSchema) }).optional(),
    heading_1: z.object({ rich_text: z.array(RichTextSchema) }).optional(),
    heading_2: z.object({ rich_text: z.array(RichTextSchema) }).optional(),
    heading_3: z.object({ rich_text: z.array(RichTextSchema) }).optional(),
    bulleted_list_item: z
      .object({ rich_text: z.array(RichTextSchema) })
      .optional(),
    numbered_list_item: z
      .object({ rich_text: z.array(RichTextSchema) })
      .optional(),
    toggle: z.object({ rich_text: z.array(RichTextSchema) }).optional(),
    to_do: z
      .object({
        rich_text: z.array(RichTextSchema),
        checked: z.boolean().optional(),
      })
      .optional(),
    quote: z.object({ rich_text: z.array(RichTextSchema) }).optional(),
    callout: z
      .object({
        rich_text: z.array(RichTextSchema),
        icon: z.unknown().optional(),
      })
      .optional(),
    code: z
      .object({
        rich_text: z.array(RichTextSchema),
        language: z.string().optional(),
      })
      .optional(),
    archived: z.boolean().optional(),
  }),
  output: BlockSchema,
};

export const blocksDeleteSchema = {
  name: 'blocksDelete',
  description: 'Delete a block (destructive)',
  notes: '',
  input: z.object({
    token: TokenParam,
    block_id: BlockIdParam,
  }),
  output: BlockSchema,
};

export const blocksChildrenListSchema = {
  name: 'blocksChildrenList',
  description: 'List block children',
  notes:
    'Returns first level of children. For nested content, recursively call for blocks with has_children=true. ' +
    'Page content is retrieved by using the page ID as block_id.',
  input: z.object({
    token: TokenParam,
    block_id: BlockIdParam,
    start_cursor: CursorParam,
    page_size: PageSizeParam,
  }),
  output: z.object({
    object: z.literal('list'),
    results: z.array(BlockSchema),
    next_cursor: z.string().nullable(),
    has_more: z.boolean(),
  }),
};

export const blocksChildrenAppendSchema = {
  name: 'blocksChildrenAppend',
  description: 'Append blocks to a parent',
  notes:
    '**DESTRUCTIVE**: Appends new blocks as children. ' +
    'Use page ID to append to a page, or block ID to append to another block.',
  input: z.object({
    token: TokenParam,
    block_id: BlockIdParam,
    children: z.array(z.unknown()).describe('Array of block objects to append'),
    after: z.string().optional().describe('Block ID to insert after'),
  }),
  output: z.object({
    object: z.literal('list'),
    results: z.array(BlockSchema),
  }),
};

// ============================================================================
// Action Schemas - Comments
// ============================================================================

export const commentsCreateSchema = {
  name: 'commentsCreate',
  description: 'Create a comment',
  notes:
    '**DESTRUCTIVE**: Creates a comment on a page or in an existing discussion. ' +
    'Requires insert comment capabilities.',
  input: z.object({
    token: TokenParam,
    parent: z.union([
      z.object({ page_id: PageIdParam }),
      z.object({ discussion_id: z.string().regex(uuidRegex) }),
    ]),
    rich_text: z.array(RichTextSchema),
  }),
  output: CommentSchema,
};

export const commentsListSchema = {
  name: 'commentsList',
  description: 'List comments on a block or page',
  notes: '',
  input: z.object({
    token: TokenParam,
    block_id: BlockIdParam.describe('Block or page ID to list comments for'),
    start_cursor: CursorParam,
    page_size: PageSizeParam,
  }),
  output: z.object({
    object: z.literal('list'),
    results: z.array(CommentSchema),
    next_cursor: z.string().nullable(),
    has_more: z.boolean(),
  }),
};

// ============================================================================
// Action Schemas - File Uploads
// ============================================================================

export const FileUploadSchema = z.object({
  object: z.literal('file_upload'),
  id: z.string().regex(uuidRegex),
  status: z.enum(['pending', 'uploaded', 'expired', 'failed']),
  filename: z.string().nullable().optional(),
  content_type: z.string().nullable().optional(),
  content_length: z.number().nullable().optional(),
  upload_url: z.string().optional(),
  complete_url: z.string().optional(),
  created_time: z.string(),
  created_by: z.object({
    id: z.string(),
    type: z.enum(['person', 'bot', 'agent']),
  }),
  last_edited_time: z.string().optional(),
  archived: z.boolean().optional(),
  expiry_time: z.string().nullable().optional(),
  file_import_result: z
    .object({
      status: z.enum(['success', 'error']).optional(),
      imported_time: z.string().optional(),
      error: z.unknown().optional(),
    })
    .optional(),
  number_of_parts: z
    .object({
      total: z.number(),
      sent: z.number(),
    })
    .optional(),
});

export const fileUploadsCreateSchema = {
  name: 'fileUploadsCreate',
  description: 'Create a file upload',
  notes:
    '**DESTRUCTIVE**: Initiates a file upload. Returns upload_url to send file content. ' +
    'Use single_part for files <20MB, multi_part for larger files.',
  input: z.object({
    token: TokenParam,
    mode: z
      .enum(['single_part', 'multi_part', 'external_url'])
      .optional()
      .describe('Upload mode (default: single_part)'),
    filename: z
      .string()
      .optional()
      .describe('File name with extension (required for multi_part)'),
    content_type: z.string().optional().describe('MIME type (recommended)'),
    number_of_parts: z
      .number()
      .optional()
      .describe('Total parts for multi_part upload (1-10000)'),
    external_url: z
      .string()
      .optional()
      .describe('HTTPS URL for external_url mode'),
  }),
  output: FileUploadSchema,
};

export const fileUploadsSendSchema = {
  name: 'fileUploadsSend',
  description: 'Send file content to an upload',
  notes:
    '**DESTRUCTIVE**: Uploads file binary content. Use multipart/form-data with "file" field. ' +
    'For chunked uploads, include part_number.',
  input: z.object({
    token: TokenParam,
    file_upload_id: z.string().regex(uuidRegex).describe('File upload ID'),
    file: z.unknown().describe('Binary file content'),
    part_number: z
      .number()
      .optional()
      .describe('Part number for multi_part uploads (1-1000)'),
  }),
  output: FileUploadSchema,
};

export const fileUploadsCompleteSchema = {
  name: 'fileUploadsComplete',
  description: 'Complete a file upload',
  notes:
    'Finalizes the upload after all parts are sent. Required to make file available.',
  input: z.object({
    token: TokenParam,
    file_upload_id: z.string().regex(uuidRegex).describe('File upload ID'),
  }),
  output: FileUploadSchema,
};

export const fileUploadsRetrieveSchema = {
  name: 'fileUploadsRetrieve',
  description: 'Retrieve a file upload status and metadata',
  notes: '',
  input: z.object({
    token: TokenParam,
    file_upload_id: z.string().regex(uuidRegex).describe('File upload ID'),
  }),
  output: FileUploadSchema,
};

export const fileUploadsListSchema = {
  name: 'fileUploadsList',
  description: 'List file uploads for the integration',
  notes: '',
  input: z.object({
    token: TokenParam,
    status: z.enum(['pending', 'uploaded', 'expired', 'failed']).optional(),
    start_cursor: CursorParam,
    page_size: PageSizeParam,
  }),
  output: z.object({
    object: z.literal('list'),
    type: z.literal('file_upload'),
    results: z.array(FileUploadSchema),
    next_cursor: z.string().nullable(),
    has_more: z.boolean(),
  }),
};

// ============================================================================
// Action Schemas - Data Sources
// ============================================================================

export const DataSourceSchema = z.object({
  object: z.literal('data_source'),
  id: z.string().regex(uuidRegex),
  title: z.array(RichTextSchema).optional(),
  description: z.array(RichTextSchema).optional(),
  properties: z.record(z.string(), z.unknown()),
  parent: z.unknown().optional(),
  database_parent: z.unknown().optional(),
  is_inline: z.boolean().optional(),
  archived: z.boolean().optional(),
  in_trash: z.boolean().optional(),
  created_time: z.string().optional(),
  last_edited_time: z.string().optional(),
  created_by: z
    .object({ object: z.literal('user'), id: z.string() })
    .optional(),
  last_edited_by: z
    .object({ object: z.literal('user'), id: z.string() })
    .optional(),
  icon: z.unknown().nullable().optional(),
  cover: z.unknown().nullable().optional(),
  url: z.string().optional(),
  public_url: z.string().nullable().optional(),
});

export const DataSourceIdParam = z
  .string()
  .regex(uuidRegex)
  .describe('Data source ID (UUID format)');

export const dataSourcesCreateSchema = {
  name: 'dataSourcesCreate',
  description: 'Create a data source',
  notes:
    '**DESTRUCTIVE**: Creates a new data source (table) within an existing database. ' +
    'Requires insert content capabilities.',
  input: z.object({
    token: TokenParam,
    parent: z.object({
      type: z.literal('database_id'),
      database_id: DatabaseIdParam,
    }),
    properties: z.record(z.string(), z.unknown()).describe('Property schema'),
    title: z.array(RichTextSchema).optional(),
    icon: z.unknown().optional(),
  }),
  output: DataSourceSchema,
};

export const dataSourcesRetrieveSchema = {
  name: 'dataSourcesRetrieve',
  description: 'Retrieve a data source metadata and property schema',
  notes: '',
  input: z.object({
    token: TokenParam,
    data_source_id: DataSourceIdParam,
  }),
  output: DataSourceSchema,
};

export const dataSourcesUpdateSchema = {
  name: 'dataSourcesUpdate',
  description: 'Update a data source',
  notes:
    '**DESTRUCTIVE**: Updates data source properties. Set property value to null to remove. ' +
    'Cannot update formula, status, synced content, or place properties.',
  input: z.object({
    token: TokenParam,
    data_source_id: DataSourceIdParam,
    title: z.array(RichTextSchema).optional(),
    icon: z.unknown().optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
    in_trash: z.boolean().optional(),
    archived: z.boolean().optional(),
    parent: z.unknown().optional().describe('Destination database when moving'),
  }),
  output: DataSourceSchema,
};

export const dataSourcesQuerySchema = {
  name: 'dataSourcesQuery',
  description: 'Query a data source',
  notes:
    'Returns pages/data sources matching filter and sort criteria. ' +
    'Similar to databasesQuery but for individual data sources.',
  input: z.object({
    token: TokenParam,
    data_source_id: DataSourceIdParam,
    filter: z.unknown().optional(),
    sorts: z.array(z.unknown()).optional(),
    start_cursor: CursorParam,
    page_size: PageSizeParam,
    archived: z.boolean().optional(),
    in_trash: z.boolean().optional(),
    result_type: z.enum(['page', 'data_source']).optional(),
    filter_properties: z
      .array(z.string())
      .optional()
      .describe('Limit returned properties'),
  }),
  output: z.object({
    object: z.literal('list'),
    type: z.literal('page_or_data_source'),
    results: z.array(z.union([PageSchema, DataSourceSchema])),
    next_cursor: z.string().nullable(),
    has_more: z.boolean(),
  }),
};

export const dataSourceTemplatesListSchema = {
  name: 'dataSourceTemplatesList',
  description: 'List templates for a data source',
  notes: '',
  input: z.object({
    token: TokenParam,
    data_source_id: DataSourceIdParam,
    name: z
      .string()
      .optional()
      .describe('Filter by name (case-insensitive substring)'),
    start_cursor: CursorParam,
    page_size: PageSizeParam,
  }),
  output: z.object({
    templates: z.array(
      z.object({
        id: z.string().regex(uuidRegex),
        name: z.string(),
        is_default: z.boolean(),
      }),
    ),
    next_cursor: z.string().nullable(),
    has_more: z.boolean(),
  }),
};

// ============================================================================
// Action Schemas - Search
// ============================================================================

export const searchSchema = {
  name: 'search',
  description: 'Search pages and databases by title',
  notes:
    'Searches titles of pages and databases shared with the integration. ' +
    'Does not search page content. Use filter to limit to pages or databases.',
  input: z.object({
    token: TokenParam,
    query: z.string().optional().describe('Search query string'),
    filter: z
      .object({
        property: z.literal('object'),
        value: z.enum(['page', 'database']),
      })
      .optional()
      .describe('Filter by object type'),
    sort: z
      .object({
        direction: z.enum(['ascending', 'descending']),
        timestamp: z.literal('last_edited_time'),
      })
      .optional(),
    start_cursor: CursorParam,
    page_size: PageSizeParam,
  }),
  output: z.object({
    object: z.literal('list'),
    results: z.array(z.union([PageSchema, DatabaseSchema])),
    next_cursor: z.string().nullable(),
    has_more: z.boolean(),
  }),
};

// ============================================================================
// Write Functions (Mutations via Internal API)
// ============================================================================

export const createPageSchema = {
  name: 'createPage',
  description:
    'Create a new page under a parent page, at the root of a teamspace, or in the Private section',
  notes:
    '**DESTRUCTIVE**: Provide either parent_id (to nest under a page) or teamspace (to create at a teamspace root). ' +
    'Use teamspace="Private" to create a page only the current user can see. ' +
    'Call listTeamspaces first to discover available teamspace names.',
  input: z.object({
    parent_id: PageIdParam.optional().describe(
      'UUID of parent page. Use this to nest the new page under an existing page. Mutually exclusive with teamspace.',
    ),
    teamspace: z
      .string()
      .optional()
      .describe(
        'Teamspace name to create the page at its root (e.g. "Founders", "Northlight AI HQ"). ' +
          'Use "Private" to create in the user\'s private section. ' +
          'Call listTeamspaces to see available names. Mutually exclusive with parent_id.',
      ),
    title: z.string().describe('Page title'),
    icon: z.string().optional().describe('Emoji icon (e.g. "📄")'),
    workspaceName: z
      .string()
      .optional()
      .describe('Workspace name to connect to'),
  }),
  output: z.object({
    id: PageIdParam,
    url: z.string().describe('Notion URL'),
  }),
};

export const updatePageSchema = {
  name: 'updatePage',
  description: 'Update page title and/or icon',
  notes: '**DESTRUCTIVE**: Updates page properties.',
  input: z.object({
    page_id: PageIdParam,
    title: z.string().optional().describe('New page title'),
    icon: z.string().optional().describe('Emoji icon'),
    workspaceName: z
      .string()
      .optional()
      .describe('Workspace name to connect to'),
  }),
  output: z.object({
    success: z.boolean(),
  }),
};

export const archivePageSchema = {
  name: 'archivePage',
  description: 'Archive (soft-delete) a page',
  notes: '**DESTRUCTIVE**: Moves page to trash.',
  input: z.object({
    page_id: PageIdParam,
    workspaceName: z
      .string()
      .optional()
      .describe('Workspace name to connect to'),
  }),
  output: z.object({
    success: z.boolean(),
  }),
};

export const restorePageSchema = {
  name: 'restorePage',
  description: 'Restore an archived page from trash',
  notes: 'Reverses archivePage. The page reappears in its original location.',
  input: z.object({
    page_id: PageIdParam,
    workspaceName: z
      .string()
      .optional()
      .describe('Workspace name to connect to'),
  }),
  output: z.object({
    success: z.boolean(),
  }),
};

export const createDatabaseSchema = {
  name: 'createDatabase',
  description: 'Create a new database with columns',
  notes:
    '**DESTRUCTIVE**: Creates a full-page or inline database as child of a page. ' +
    'Set inline: true for an inline database (renders inside the page), omit or false for full-page (gets its own page). ' +
    'Auto-adds "Name" title column if missing. ' +
    'select/multi_select/status types need options array. Status type also accepts optional groups (defaults to To-do/In progress/Complete). All other types just need {type: "<type>"}.',
  input: z.object({
    parent_id: PageIdParam.describe('UUID of parent page'),
    title: z.string().describe('Database title'),
    properties: z
      .record(
        z.string(),
        z.object({
          type: z
            .enum([
              'text',
              'number',
              'select',
              'multi_select',
              'status',
              'date',
              'checkbox',
              'url',
              'email',
              'phone_number',
            ])
            .describe(
              'Column type. select/multi_select require options array. All others just need type.',
            ),
          options: z
            .array(
              z.object({
                value: z.string(),
                color: z
                  .enum([
                    'default',
                    'gray',
                    'brown',
                    'orange',
                    'yellow',
                    'green',
                    'blue',
                    'purple',
                    'pink',
                    'red',
                  ])
                  .describe('Required color for select options'),
              }),
            )
            .optional()
            .describe('For select/multi_select/status types'),
          groups: z
            .array(
              z.object({
                name: z.string(),
                color: z.enum([
                  'default',
                  'gray',
                  'brown',
                  'orange',
                  'yellow',
                  'green',
                  'blue',
                  'purple',
                  'pink',
                  'red',
                ]),
              }),
            )
            .optional()
            .describe(
              'For status type: category groups. Defaults to To-do, In progress, Complete if omitted.',
            ),
        }),
      )
      .describe(
        'Column definitions. Examples: {"Status": {type: "select", options: [{value: "Done", color: "green"}]}, "Notes": {type: "text"}, "Count": {type: "number"}}',
      ),
    inline: z
      .boolean()
      .optional()
      .describe(
        'If true, creates an inline database (renders inside the parent page). If false/omitted, creates a full-page database (gets its own page).',
      ),
    workspaceName: z
      .string()
      .optional()
      .describe('Workspace name to connect to'),
  }),
  output: z.object({
    id: PageIdParam.describe('Database page ID'),
    collection_id: z.string().describe('Collection ID'),
    view_id: z.string().describe('View ID'),
    url: z.string().describe('Notion URL'),
  }),
};

export const queryDatabaseSchema = {
  name: 'queryDatabase',
  description: 'Query a database to list its rows',
  notes:
    'Returns rows with flattened property values as simple strings. ' +
    'Use the database page ID (from createDatabase), not the collection ID. Works with both full-page and inline databases.',
  input: z.object({
    database_id: PageIdParam.describe('Database page ID'),
    filter: z
      .object({
        operator: z
          .enum(['and', 'or'])
          .optional()
          .describe('How to combine multiple conditions (default: and)'),
        conditions: z.array(
          z.object({
            property: z
              .string()
              .describe('Property name (e.g. "Status", "Priority")'),
            operator: z
              .enum([
                'equals',
                'not_equals',
                'contains',
                'not_contains',
                'starts_with',
                'ends_with',
                'is_empty',
                'is_not_empty',
                'greater_than',
                'less_than',
                'before',
                'after',
              ])
              .describe(
                'Comparison operator. Use equals/not_equals for select, contains/not_contains for text, before/after for dates, greater_than/less_than for numbers.',
              ),
            value: z
              .string()
              .optional()
              .describe(
                'Value to compare against. Omit for is_empty/is_not_empty.',
              ),
          }),
        ),
      })
      .optional()
      .describe('Filter rows by property values'),
    sort: z
      .array(
        z.object({
          property: z
            .string()
            .describe('Property name to sort by (e.g. "Due Date", "Name")'),
          direction: z
            .enum(['ascending', 'descending'])
            .describe('Sort direction'),
        }),
      )
      .optional()
      .describe('Sort rows by one or more properties'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe('Max rows to return (default 50, max 100)'),
    workspaceName: z
      .string()
      .optional()
      .describe('Workspace name to connect to'),
  }),
  output: z.object({
    rows: z.array(
      z.object({
        id: PageIdParam,
        properties: z
          .record(z.string(), z.string())
          .describe('Flattened property values'),
        url: z.string(),
      }),
    ),
    schema: z
      .record(
        z.string(),
        z.object({
          type: z.string(),
        }),
      )
      .describe(
        'Database schema keyed by property name (e.g. "Status", "Priority")',
      ),
    total: z
      .number()
      .describe(
        'Total rows in the database, or total matching rows when a filter is applied',
      ),
  }),
};

export const addDatabaseRowSchema = {
  name: 'addDatabaseRow',
  description: 'Add a row to a database',
  notes:
    '**DESTRUCTIVE**: Creates a new row. Properties are key-value pairs where keys match column names.',
  input: z.object({
    database_id: PageIdParam.describe('Database page ID'),
    properties: z
      .record(z.string(), z.union([z.string(), z.boolean()]))
      .describe(
        'Property values: {"Name": "John", "Status": "Done"}. For checkbox properties, pass true/false or "Yes"/"No".',
      ),
    workspaceName: z
      .string()
      .optional()
      .describe('Workspace name to connect to'),
  }),
  output: z.object({
    id: PageIdParam.describe('Row ID'),
    url: z.string(),
  }),
};

export const updateDatabaseRowSchema = {
  name: 'updateDatabaseRow',
  description: 'Update properties of an existing database row',
  notes:
    '**DESTRUCTIVE**: Updates row properties. Only provided properties are updated.',
  input: z.object({
    row_id: PageIdParam.describe('Row/page ID'),
    database_id: PageIdParam.describe('Database page ID (for schema lookup)'),
    properties: z
      .record(z.string(), z.union([z.string(), z.boolean()]))
      .describe(
        'Property values to update. For checkbox properties, pass true/false or "Yes"/"No".',
      ),
    workspaceName: z
      .string()
      .optional()
      .describe('Workspace name to connect to'),
  }),
  output: z.object({
    success: z.boolean(),
  }),
};

export const addDatabasePropertySchema = {
  name: 'addDatabaseProperty',
  description: 'Add a new column/property to a database',
  notes: '**DESTRUCTIVE**: Adds a column to the database schema.',
  input: z.object({
    database_id: PageIdParam.describe('Database page ID'),
    name: z.string().describe('Column name'),
    type: z
      .enum([
        'text',
        'number',
        'select',
        'multi_select',
        'status',
        'date',
        'checkbox',
        'url',
        'email',
        'phone_number',
      ])
      .describe('Property type'),
    options: z
      .array(
        z.object({
          value: z.string(),
          color: z
            .enum([
              'default',
              'gray',
              'brown',
              'orange',
              'yellow',
              'green',
              'blue',
              'purple',
              'pink',
              'red',
            ])
            .describe('Required color for select options'),
        }),
      )
      .optional()
      .describe('For select/multi_select/status types'),
    groups: z
      .array(
        z.object({
          name: z.string(),
          color: z.enum([
            'default',
            'gray',
            'brown',
            'orange',
            'yellow',
            'green',
            'blue',
            'purple',
            'pink',
            'red',
          ]),
        }),
      )
      .optional()
      .describe(
        'For status type: category groups. Defaults to To-do, In progress, Complete if omitted.',
      ),
    workspaceName: z
      .string()
      .optional()
      .describe('Workspace name to connect to'),
  }),
  output: z.object({
    success: z.boolean(),
    property_id: z.string().describe('Generated property ID'),
  }),
};

export const removeDatabasePropertySchema = {
  name: 'removeDatabaseProperty',
  description: 'Remove a column from a database',
  notes:
    '**DESTRUCTIVE**: Deletes a column and all its data. Cannot remove title property.',
  input: z.object({
    database_id: PageIdParam.describe('Database page ID'),
    property_name: z.string().describe('Name of property to remove'),
    workspaceName: z
      .string()
      .optional()
      .describe('Workspace name to connect to'),
  }),
  output: z.object({
    success: z.boolean(),
  }),
};

const blockEntrySchema: z.ZodType<{
  id: string;
  type: string;
  content: string;
  has_children: boolean;
  children?: unknown[];
}> = z.lazy(() =>
  z.object({
    id: z.string().describe('Block ID (use with deleteBlock)'),
    type: z
      .string()
      .describe('Block type (text, heading_1, bulleted_list, etc.)'),
    content: z.string().describe('Text content of the block'),
    has_children: z.boolean().describe('Whether this block has child blocks'),
    children: z
      .array(blockEntrySchema)
      .optional()
      .describe(
        'Child blocks (only present when recursive: true). Same shape as parent blocks.',
      ),
  }),
);

export const listBlocksSchema = {
  name: 'listBlocks',
  description:
    'List all content blocks on a page with their IDs, types, and text content',
  notes:
    'Use this to get block IDs needed for deleteBlock or moveBlock. Set recursive: true to include nested child blocks (up to max_depth levels).',
  input: z.object({
    page_id: PageIdParam,
    recursive: z
      .boolean()
      .optional()
      .describe('If true, recursively include child blocks. Default: false.'),
    max_depth: z
      .number()
      .int()
      .min(1)
      .max(5)
      .optional()
      .describe('Max recursion depth when recursive is true. Default: 3.'),
    workspaceName: z
      .string()
      .optional()
      .describe('Workspace name to connect to'),
  }),
  output: z.object({
    blocks: z.array(blockEntrySchema),
  }),
};

export type ListBlocksInput = z.infer<typeof listBlocksSchema.input>;

export const appendBlocksSchema = {
  name: 'appendBlocks',
  description:
    'Append content blocks to a page, optionally after a specific block',
  notes:
    '**DESTRUCTIVE**: Adds blocks to the end of a page, or after a specific block if after_block_id is provided.',
  input: z.object({
    page_id: PageIdParam,
    blocks: z.array(
      z.object({
        type: z
          .enum([
            'text',
            'paragraph',
            'heading_1',
            'heading_2',
            'heading_3',
            'bulleted_list',
            'bulleted_list_item',
            'numbered_list',
            'numbered_list_item',
            'to_do',
            'toggle',
            'quote',
            'callout',
            'code',
            'divider',
          ])
          .describe(
            'Block type. paragraph = text, bulleted_list_item = bulleted_list, numbered_list_item = numbered_list',
          ),
        content: z
          .string()
          .optional()
          .describe('Text content (not needed for divider)'),
        checked: z.boolean().optional().describe('For to_do blocks'),
        language: z.string().optional().describe('For code blocks'),
        emoji: z
          .string()
          .optional()
          .describe(
            'Icon emoji for callout blocks (e.g. "💡"). Defaults to "💡" if omitted',
          ),
      }),
    ),
    after_block_id: z
      .string()
      .optional()
      .describe(
        'Block ID to insert after. If omitted, appends to end of page.',
      ),
    workspaceName: z
      .string()
      .optional()
      .describe('Workspace name to connect to'),
  }),
  output: z.object({
    block_ids: z.array(z.string()).describe('Created block IDs'),
  }),
};

export const deleteBlockSchema = {
  name: 'deleteBlock',
  description: 'Delete a block from a page',
  notes: '**DESTRUCTIVE**: Permanently removes a block.',
  input: z.object({
    block_id: BlockIdParam,
    workspaceName: z
      .string()
      .optional()
      .describe('Workspace name to connect to'),
  }),
  output: z.object({
    success: z.boolean(),
  }),
};

export const moveBlockSchema = {
  name: 'moveBlock',
  description:
    'Move a block to a different parent page or position within the same page',
  notes:
    '**DESTRUCTIVE**: Removes block from current location and inserts at new location. Use after_block_id to control position within target parent.',
  input: z.object({
    block_id: BlockIdParam,
    target_parent_id: PageIdParam.describe('UUID of target parent page'),
    after_block_id: z
      .string()
      .optional()
      .describe(
        'Block ID to insert after in target parent. If omitted, appends to end.',
      ),
    workspaceName: z
      .string()
      .optional()
      .describe('Workspace name to connect to'),
  }),
  output: z.object({ success: z.boolean() }),
};

export const replaceSectionSchema = {
  name: 'replaceSection',
  description: 'Replace all content under a heading with new blocks',
  notes:
    '**DESTRUCTIVE**: Deletes all blocks between the specified heading and the next heading of same or higher level, then inserts new blocks. The heading itself is preserved.',
  input: z.object({
    page_id: PageIdParam,
    heading_block_id: BlockIdParam.describe(
      'UUID of the heading block whose section content to replace',
    ),
    new_blocks: z
      .array(
        z.object({
          type: z
            .enum([
              'text',
              'paragraph',
              'heading_1',
              'heading_2',
              'heading_3',
              'bulleted_list',
              'bulleted_list_item',
              'numbered_list',
              'numbered_list_item',
              'to_do',
              'toggle',
              'quote',
              'callout',
              'code',
              'divider',
            ])
            .describe(
              'Block type. paragraph = text, bulleted_list_item = bulleted_list, numbered_list_item = numbered_list',
            ),
          content: z.string().optional().describe('Text content'),
          checked: z.boolean().optional().describe('For to_do blocks'),
          language: z.string().optional().describe('For code blocks'),
          emoji: z.string().optional().describe('For callout blocks'),
        }),
      )
      .describe('New blocks to insert under the heading'),
    workspaceName: z
      .string()
      .optional()
      .describe('Workspace name to connect to'),
  }),
  output: z.object({
    deleted_block_ids: z.array(z.string()),
    new_block_ids: z.array(z.string()),
  }),
};

export const addImageBlockSchema = {
  name: 'addImageBlock',
  description: 'Upload an image from a URL and add it inline to a page',
  notes:
    "**DESTRUCTIVE**: Downloads the image and uploads it to Notion's S3 storage, then creates an image block.",
  input: z.object({
    page_id: PageIdParam,
    image_url: z.string().describe('URL to download the image from'),
    caption: z.string().optional().describe('Optional caption for the image'),
    after_block_id: z
      .string()
      .optional()
      .describe(
        'Block ID to insert after. If omitted, appends to end of page.',
      ),
    workspaceName: z
      .string()
      .optional()
      .describe('Workspace name to connect to'),
  }),
  output: z.object({
    block_id: z.string().describe('Created image block ID'),
  }),
};

export const copyBlocksSchema = {
  name: 'copyBlocks',
  description: 'Copy all content blocks from one page to another',
  notes: '**DESTRUCTIVE**: Creates duplicate blocks in the target page.',
  input: z.object({
    source_page_id: PageIdParam.describe(
      'UUID of the source page to copy from',
    ),
    target_page_id: PageIdParam.describe(
      'UUID of the target page to copy into',
    ),
    workspaceName: z
      .string()
      .optional()
      .describe('Workspace name to connect to'),
  }),
  output: z.object({
    copied_count: z.number().describe('Number of blocks copied'),
  }),
};

export const getDatabaseSchemaSchema = {
  name: 'getDatabaseSchema',
  description: 'Get the schema (columns/properties) of a database',
  notes: 'Returns database structure without data.',
  input: z.object({
    database_id: PageIdParam.describe('Database page ID'),
    workspaceName: z
      .string()
      .optional()
      .describe('Workspace name to connect to'),
  }),
  output: z.object({
    schema: z
      .record(
        z.string(),
        z.object({
          type: z.string(),
          options: z
            .array(
              z.object({
                value: z.string(),
                color: z.string(),
              }),
            )
            .optional(),
        }),
      )
      .describe(
        'Property definitions keyed by human-readable property name (e.g. "Status", "Priority")',
      ),
    title: z.string().describe('Database title'),
  }),
};

// ============================================================================
// Convenience Functions (Read-Optimized)
// ============================================================================

export const listRecentPagesSchema = {
  name: 'listRecentPages',
  description:
    'List recently edited pages and databases in the workspace for browsing',
  notes:
    'Returns pages and databases sorted by last edit time. Great for exploring workspace content ' +
    "when you don't know specific page names or IDs.",
  input: z.object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe('Number of pages to return (default 20, max 100)'),
    workspaceName: z
      .string()
      .optional()
      .describe(
        'Workspace name to connect to. Use listWorkspaces to see available options.',
      ),
  }),
  output: z.object({
    pages: z.array(
      z.object({
        id: PageIdParam,
        title: z.string().describe('Page or database title'),
        url: z.string().describe('Notion URL'),
        last_edited: z.string().describe('ISO 8601 timestamp'),
        type: z
          .enum(['page', 'database'])
          .describe('Whether this is a page or database'),
      }),
    ),
  }),
};

export const getPageAsTextSchema = {
  name: 'getPageAsText',
  description: 'Get full page content as readable plain text',
  notes:
    'Recursively fetches all blocks and formats as markdown-like text. ' +
    'Inline databases appear as summaries with column names, row count, and sample rows. ' +
    'Use queryDatabase with the database ID to read full database contents. ' +
    'Non-text blocks (images, embeds, etc.) appear as labeled placeholders.',
  input: z.object({
    page_id: PageIdParam,
    max_depth: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe('Maximum nesting depth for child blocks (default 3)'),
    workspaceName: z
      .string()
      .optional()
      .describe(
        'Workspace name to connect to. Use listWorkspaces to see available options.',
      ),
  }),
  output: z.object({
    title: z.string().describe('Page title'),
    url: z.string().describe('Notion URL'),
    content: z.string().describe('Full page content as formatted text'),
  }),
};

export const quickSearchSchema = {
  name: 'quickSearch',
  description:
    'Search pages and databases by title or content (equivalent to Cmd+K quick find)',
  notes:
    'Searches across titles and body content. Returns results ranked by relevance. ' +
    'Database rows that match appear as their parent page.',
  input: z.object({
    query: z
      .string()
      .describe('Search query to match against titles and content'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe('Number of results (default 10, max 20)'),
    workspaceName: z
      .string()
      .optional()
      .describe(
        'Workspace name to connect to. Use listWorkspaces to see available options.',
      ),
  }),
  output: z.object({
    results: z.array(
      z.object({
        id: PageIdParam,
        title: z.string().describe('Page title'),
        url: z.string().describe('Notion URL'),
        preview: z.string().describe('First ~200 chars of page content'),
        last_edited: z.string().describe('ISO 8601 timestamp'),
      }),
    ),
  }),
};

// ============================================================================
// Sharing & Permissions
// ============================================================================

const PermissionRoleEnum = z.enum([
  'editor',
  'read_and_write',
  'comment_only',
  'reader',
]);

export const sharePageSchema = {
  name: 'sharePage',
  description:
    'Share a page with someone by email. Sends an invitation and grants access.',
  notes:
    '**DESTRUCTIVE**: Sends an invitation email and grants page access. Creates a Notion user for the email if they do not already have an account. ' +
    'Permission roles: editor (full access), read_and_write (can edit), comment_only, reader (view only).',
  input: z.object({
    page_id: PageIdParam.describe('Page to share'),
    email: z.string().email().describe('Email address of the person to invite'),
    role: PermissionRoleEnum.optional().describe(
      'Permission level (default: reader). editor=full access, read_and_write=can edit, comment_only=can comment, reader=view only',
    ),
    workspaceName: z
      .string()
      .optional()
      .describe('Workspace name to connect to'),
  }),
  output: z.object({
    success: z.boolean(),
    user_id: z.string().describe('Notion user ID of the invited person'),
  }),
};

export const updatePagePermissionSchema = {
  name: 'updatePagePermission',
  description:
    "Change or remove someone's access to a page. Set role to 'none' to remove access entirely.",
  notes:
    "**DESTRUCTIVE**: Changes or removes page access. Requires the user's Notion user ID (from sharePage or getContext). " +
    "Set role to 'none' to revoke access completely.",
  input: z.object({
    page_id: PageIdParam.describe('Page to update permissions on'),
    user_id: UserIdParam.describe(
      'Notion user ID of the person (returned by sharePage)',
    ),
    role: z
      .enum(['editor', 'read_and_write', 'comment_only', 'reader', 'none'])
      .describe("New permission level. Use 'none' to remove access entirely."),
    workspaceName: z
      .string()
      .optional()
      .describe('Workspace name to connect to'),
  }),
  output: z.object({
    success: z.boolean(),
  }),
};

export const getPagePermissionsSchema = {
  name: 'getPagePermissions',
  description:
    'Get current share settings, permissions, and public access status for a page',
  notes: '',
  input: z.object({
    page_id: PageIdParam.describe('Page to check permissions for'),
    workspaceName: z.string().optional(),
  }),
  output: z.object({
    permissions: z.array(
      z.object({
        type: z
          .string()
          .describe(
            'Permission type: "public_permission", "user_permission", or "space_permission"',
          ),
        role: z
          .string()
          .describe(
            'Access level: "editor", "read_and_write", "comment_only", "reader", "none"',
          ),
        user_id: z
          .string()
          .optional()
          .describe('User ID (for user_permission type)'),
        allow_duplicate: z
          .boolean()
          .optional()
          .describe('Whether page can be duplicated as template'),
        allow_search_engine_indexing: z
          .boolean()
          .optional()
          .describe('Whether search engines can index the page'),
      }),
    ),
    public_access: z
      .boolean()
      .describe('Whether the page is published to the web'),
    public_url: z
      .string()
      .nullable()
      .describe('Public URL if page is published, null otherwise'),
  }),
};

export type GetPagePermissionsInput = z.input<
  typeof getPagePermissionsSchema.input
>;

export const publishToWebSchema = {
  name: 'publishToWeb',
  description:
    'Enable or disable "Share to web" for a page, making it publicly accessible via a link',
  notes:
    '**DESTRUCTIVE**: Toggles public web access. Set enabled=false to unpublish. ' +
    'Workspace admin settings may block public access (check getWorkspaceDetails.disable_public_access).',
  input: z.object({
    page_id: PageIdParam.describe('Page to publish/unpublish'),
    enabled: z
      .boolean()
      .optional()
      .default(true)
      .describe('true to publish, false to unpublish (default: true)'),
    role: z
      .enum(['reader', 'comment_only', 'editor'])
      .default('reader')
      .describe(
        'Public access level. reader=view only (recommended default), comment_only=can comment, editor=can edit',
      ),
    allow_duplicate: z
      .boolean()
      .optional()
      .describe(
        'Allow visitors to duplicate the page as a template (default: false)',
      ),
    allow_search_engine_indexing: z
      .boolean()
      .optional()
      .describe('Allow search engines to index the page'),
    workspaceName: z.string().optional(),
  }),
  output: z.object({
    success: z.boolean(),
    public_url: z
      .string()
      .nullable()
      .describe('Public URL if published, null if unpublished'),
  }),
};

export type PublishToWebInput = z.input<typeof publishToWebSchema.input>;

export const getPageLinkSchema = {
  name: 'getPageLink',
  description:
    'Get shareable links for a page: both the internal Notion URL and public URL if published',
  notes:
    'The internal URL always works for workspace members. The public URL only works if publishToWeb was called.',
  input: z.object({
    page_id: PageIdParam.describe('Page to get links for'),
    workspaceName: z.string().optional(),
  }),
  output: z.object({
    url: z
      .string()
      .describe(
        'Internal Notion URL (always available, works for workspace members)',
      ),
    public_url: z
      .string()
      .nullable()
      .describe('Public URL via notion.site (null if not published)'),
    is_published: z
      .boolean()
      .describe('Whether the page is published to the web'),
  }),
};

export type GetPageLinkInput = z.input<typeof getPageLinkSchema.input>;

// ============================================================================
// All Schemas Export
// ============================================================================

export const allSchemas = [
  // Workspaces
  listWorkspacesSchema,
  listTeamspacesSchema,
  // Context
  getContextSchema,
  // Workspace Details & Subscription
  getWorkspaceDetailsSchema,
  getSubscriptionSchema,
  // Convenience (Read-Optimized)
  listRecentPagesSchema,
  getPageAsTextSchema,
  quickSearchSchema,
  // Write Functions (Mutations)
  createPageSchema,
  updatePageSchema,
  archivePageSchema,
  restorePageSchema,
  createDatabaseSchema,
  queryDatabaseSchema,
  addDatabaseRowSchema,
  updateDatabaseRowSchema,
  addDatabasePropertySchema,
  removeDatabasePropertySchema,
  listBlocksSchema,
  appendBlocksSchema,
  deleteBlockSchema,
  moveBlockSchema,
  replaceSectionSchema,
  addImageBlockSchema,
  copyBlocksSchema,
  getDatabaseSchemaSchema,
  // Sharing & Permissions
  sharePageSchema,
  updatePagePermissionSchema,
  getPagePermissionsSchema,
  publishToWebSchema,
  getPageLinkSchema,
];

// ============================================================================
// Inferred Types
// ============================================================================

export type NotionContext = z.infer<typeof NotionContextSchema>;
export type User = z.infer<typeof UserSchema>;
export type Page = z.infer<typeof PageSchema>;
export type Database = z.infer<typeof DatabaseSchema>;
export type Block = z.infer<typeof BlockSchema>;
export type Comment = z.infer<typeof CommentSchema>;
export type RichText = z.infer<typeof RichTextSchema>;
export type Parent = z.infer<typeof ParentSchema>;
export type FileUpload = z.infer<typeof FileUploadSchema>;
export type DataSource = z.infer<typeof DataSourceSchema>;

// ============================================================================
// Input Types (z.input preserves optional before defaults applied)
// ============================================================================

export type ListWorkspacesInput = z.input<typeof listWorkspacesSchema.input>;
export type ListTeamspacesInput = z.input<typeof listTeamspacesSchema.input>;
export type GetContextInput = z.input<typeof getContextSchema.input>;
export type GetWorkspaceDetailsInput = z.input<
  typeof getWorkspaceDetailsSchema.input
>;
export type GetSubscriptionInput = z.input<typeof getSubscriptionSchema.input>;
export type GetMeInput = z.input<typeof getMeSchema.input>;
export type UsersListInput = z.input<typeof usersListSchema.input>;
export type UsersGetInput = z.input<typeof usersGetSchema.input>;
export type PagesCreateInput = z.input<typeof pagesCreateSchema.input>;
export type PagesRetrieveInput = z.input<typeof pagesRetrieveSchema.input>;
export type PagesUpdateInput = z.input<typeof pagesUpdateSchema.input>;
export type PagesArchiveInput = z.input<typeof pagesArchiveSchema.input>;
export type PagePropertyRetrieveInput = z.input<
  typeof pagePropertyRetrieveSchema.input
>;
export type PagesMoveInput = z.input<typeof pagesMoveSchema.input>;
export type DatabasesCreateInput = z.input<typeof databasesCreateSchema.input>;
export type DatabasesRetrieveInput = z.input<
  typeof databasesRetrieveSchema.input
>;
export type DatabasesUpdateInput = z.input<typeof databasesUpdateSchema.input>;
export type DatabasesQueryInput = z.input<typeof databasesQuerySchema.input>;
export type BlocksRetrieveInput = z.input<typeof blocksRetrieveSchema.input>;
export type BlocksUpdateInput = z.input<typeof blocksUpdateSchema.input>;
export type BlocksDeleteInput = z.input<typeof blocksDeleteSchema.input>;
export type BlocksChildrenListInput = z.input<
  typeof blocksChildrenListSchema.input
>;
export type BlocksChildrenAppendInput = z.input<
  typeof blocksChildrenAppendSchema.input
>;
export type CommentsCreateInput = z.input<typeof commentsCreateSchema.input>;
export type CommentsListInput = z.input<typeof commentsListSchema.input>;
export type FileUploadsCreateInput = z.input<
  typeof fileUploadsCreateSchema.input
>;
export type FileUploadsSendInput = z.input<typeof fileUploadsSendSchema.input>;
export type FileUploadsCompleteInput = z.input<
  typeof fileUploadsCompleteSchema.input
>;
export type FileUploadsRetrieveInput = z.input<
  typeof fileUploadsRetrieveSchema.input
>;
export type FileUploadsListInput = z.input<typeof fileUploadsListSchema.input>;
export type DataSourcesCreateInput = z.input<
  typeof dataSourcesCreateSchema.input
>;
export type DataSourcesRetrieveInput = z.input<
  typeof dataSourcesRetrieveSchema.input
>;
export type DataSourcesUpdateInput = z.input<
  typeof dataSourcesUpdateSchema.input
>;
export type DataSourcesQueryInput = z.input<
  typeof dataSourcesQuerySchema.input
>;
export type DataSourceTemplatesListInput = z.input<
  typeof dataSourceTemplatesListSchema.input
>;
export type SearchInput = z.input<typeof searchSchema.input>;
export type ListRecentPagesInput = z.input<typeof listRecentPagesSchema.input>;
export type GetPageAsTextInput = z.input<typeof getPageAsTextSchema.input>;
export type QuickSearchInput = z.input<typeof quickSearchSchema.input>;
export type CreatePageInput = z.input<typeof createPageSchema.input>;
export type UpdatePageInput = z.input<typeof updatePageSchema.input>;
export type ArchivePageInput = z.input<typeof archivePageSchema.input>;
export type RestorePageInput = z.input<typeof restorePageSchema.input>;
export type CreateDatabaseInput = z.input<typeof createDatabaseSchema.input>;
export type QueryDatabaseInput = z.input<typeof queryDatabaseSchema.input>;
export type AddDatabaseRowInput = z.input<typeof addDatabaseRowSchema.input>;
export type UpdateDatabaseRowInput = z.input<
  typeof updateDatabaseRowSchema.input
>;
export type AddDatabasePropertyInput = z.input<
  typeof addDatabasePropertySchema.input
>;
export type RemoveDatabasePropertyInput = z.input<
  typeof removeDatabasePropertySchema.input
>;
export type AppendBlocksInput = z.input<typeof appendBlocksSchema.input>;
export type DeleteBlockInput = z.input<typeof deleteBlockSchema.input>;
export type MoveBlockInput = z.input<typeof moveBlockSchema.input>;
export type ReplaceSectionInput = z.input<typeof replaceSectionSchema.input>;
export type AddImageBlockInput = z.infer<typeof addImageBlockSchema.input>;
export type CopyBlocksInput = z.infer<typeof copyBlocksSchema.input>;
export type GetDatabaseSchemaInput = z.input<
  typeof getDatabaseSchemaSchema.input
>;
export type SharePageInput = z.input<typeof sharePageSchema.input>;
export type UpdatePagePermissionInput = z.input<
  typeof updatePagePermissionSchema.input
>;
