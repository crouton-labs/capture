import { z } from 'zod';

const AccessTokenParam = z
  .string()
  .describe('Bearer access token from getContext()');

const WorkspaceIdParam = z
  .string()
  .describe('Workspace UUID from getContext()');

// ============================================================================
// Entity Schemas
// ============================================================================

export const PageSchema = z
  .object({
    id: z.string().describe('Internal hash ID'),
    objectId: z.string().describe('Page UUID; use as the page ID parameter'),
    _title: z.string().optional().describe('Page title'),
    _lastUpdatedAt: z
      .string()
      .optional()
      .describe(
        'User-visible last-edited timestamp (ISO). May differ from updatedAt which is the Materialize DB timestamp.',
      ),
    _exists: z
      .string()
      .optional()
      .describe('Internal existence marker (empty string when present)'),
    '@creator': z
      .array(z.string())
      .optional()
      .describe('Creator in format "native_user : userId"'),
    sharedWithUsers: z
      .array(z.string())
      .optional()
      .describe('User UUIDs this page is shared with'),
    sharedWithWorkspace: z
      .boolean()
      .optional()
      .describe('Whether page is shared with the entire workspace'),
    '@parent': z
      .array(z.string())
      .optional()
      .describe(
        'Parent template reference in format "native_template : uuid". Present on pages created from templates.',
      ),
    mzTimestamp: z
      .number()
      .optional()
      .describe('Materialize DB internal timestamp'),
    createdAt: z.string().describe('ISO timestamp when created'),
    updatedAt: z.string().describe('ISO timestamp when last updated'),
  })
  .passthrough()
  .describe(
    'Page record from list. Common fields: id, objectId (UUID), _title, createdAt, updatedAt',
  );

export const PageParentObjectSchema = z
  .object({
    objectId: z
      .string()
      .describe(
        'WARNING: Despite the field name, Day.ai stores the object type string here (e.g., "native_draft", "native_contact"). The fields are swapped from conventional naming.',
      ),
    objectType: z
      .string()
      .describe(
        'WARNING: Despite the field name, Day.ai stores the object UUID here (not the type string). The fields are swapped from conventional naming.',
      ),
  })
  .describe(
    'Parent object this page is attached to. NOTE: Day.ai returns objectId/objectType fields swapped; objectId contains the type string (e.g., "native_draft") and objectType contains the UUID.',
  );

export const PageCrmObjectSchema = z
  .object({
    objectId: z
      .string()
      .describe(
        'WARNING: Despite the field name, Day.ai stores the object type string here (e.g., "native_contact", "native_organization"). The fields are swapped from conventional naming.',
      ),
    objectType: z
      .string()
      .describe(
        'WARNING: Despite the field name, Day.ai stores the object UUID or identifier here (not the type string). The fields are swapped from conventional naming.',
      ),
    properties: z
      .record(z.string(), z.unknown())
      .nullable()
      .describe('CRM object properties snapshot'),
    workspaceId: z.string().describe('Workspace UUID'),
  })
  .describe(
    'CRM object linked to this page. NOTE: Day.ai returns objectId/objectType fields swapped; objectId contains the type string (e.g., "native_contact") and objectType contains the UUID/identifier.',
  );

export const PageSourceTemplateSchema = z
  .object({
    id: z.string().describe('Source template UUID'),
    templateType: z.string().nullable().describe('Template type identifier'),
  })
  .describe('Template this page was created from');

export const PageAuthorizationSchema = z
  .object({
    workspace: z
      .object({
        isShared: z
          .boolean()
          .describe('Whether page is shared with the workspace'),
      })
      .describe('Workspace-level sharing status'),
    users: z
      .array(
        z.object({
          id: z.string().describe('User UUID'),
          accessLevel: z
            .string()
            .describe('Access level (e.g., "owner", "editor", "viewer")'),
        }),
      )
      .describe('Per-user access control entries'),
  })
  .describe('Page authorization and sharing settings');

export const WorkspaceUserContextSchema = z
  .object({
    id: z.string().describe('Context entry UUID'),
    userId: z.string().describe('User UUID who created this context'),
    workspaceId: z.string().describe('Workspace UUID'),
    pageTitle: z
      .string()
      .nullable()
      .optional()
      .describe('Title of the linked page'),
    createdAt: z.string().describe('ISO timestamp when created'),
    updatedAt: z.string().describe('ISO timestamp when last updated'),
  })
  .describe('AI instruction/context entry linked to a page');

export const PageDetailSchema = z.object({
  id: z.string().describe('Page UUID'),
  title: z.string().describe('Page title'),
  contentJson: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Page body as Tiptap JSON document'),
  contentHtml: z.string().optional().describe('Page body as HTML'),
  ownerEmail: z.string().optional().describe('Email of the page owner'),
  workspaceId: z.string().describe('Workspace UUID'),
  createdAt: z.string().describe('ISO timestamp when created'),
  updatedAt: z.string().describe('ISO timestamp when last updated'),
  shortLinkHash: z.string().optional().describe('Short link hash for sharing'),
  madeExternalAt: z
    .string()
    .nullable()
    .optional()
    .describe('When page was made public externally'),
  emoji: z.string().nullable().optional().describe('Page emoji icon'),
  isKnowledge: z
    .boolean()
    .nullable()
    .optional()
    .describe('Whether page is a knowledge base entry'),
  templateType: z.string().nullable().optional().describe('Template type'),
  headerImage: z
    .string()
    .nullable()
    .optional()
    .describe('Header image URL for the page'),
  publishedForUserAt: z
    .string()
    .nullable()
    .optional()
    .describe('When page was published for the user (ISO timestamp)'),
  parentObject: PageParentObjectSchema.nullable()
    .optional()
    .describe('Parent object this page is attached to, or null if standalone'),
  crmObjects: z
    .array(PageCrmObjectSchema)
    .nullable()
    .optional()
    .describe('CRM objects (contacts, organizations) linked to this page'),
  aiInitialPrompt: z
    .string()
    .nullable()
    .optional()
    .describe('AI prompt used to initially generate this page content'),
  aiPopulationCompletedAt: z
    .string()
    .nullable()
    .optional()
    .describe('When AI content population completed (ISO timestamp)'),
  sourceTemplate: PageSourceTemplateSchema.nullable()
    .optional()
    .describe(
      'Template this page was created from, or null if not from a template',
    ),
  authorization: PageAuthorizationSchema.optional().describe(
    'Page authorization and sharing settings. Only included when includeAuthorization is true.',
  ),
  people: z
    .array(z.string())
    .optional()
    .describe(
      'Email addresses of people associated with this page. Always included in response.',
    ),
  domains: z
    .array(z.string())
    .optional()
    .describe(
      'Domain names associated with this page. Always included in response.',
    ),
  actionIds: z
    .array(z.string())
    .optional()
    .describe(
      'UUIDs of actions linked to this page. Always included in response.',
    ),
  instructions: z
    .array(WorkspaceUserContextSchema)
    .nullable()
    .optional()
    .describe(
      'AI instructions/context entries linked to this page. Only included when includeInstructions is true.',
    ),
});

export const DraftSchema = z
  .object({
    id: z.string().describe('Internal hash ID'),
    objectId: z.string().describe('Draft UUID; use as the draft ID parameter'),
    '_email/subject': z.string().optional().describe('Email subject line'),
    '_email/from': z.string().optional().describe('Sender email address'),
    _status: z
      .enum(['DRAFT', 'SENDING', 'SENT', 'FAILED'])
      .optional()
      .describe('Email draft status (uppercase)'),
    _channel: z
      .string()
      .optional()
      .describe('Communication channel (e.g., "EMAIL")'),
    _type: z.string().optional().describe('Draft type (e.g., "CONVERSATION")'),
    _lastUpdatedAt: z
      .string()
      .optional()
      .describe(
        'User-visible last-edited timestamp (ISO). May differ from updatedAt which is the Materialize DB timestamp.',
      ),
    _exists: z
      .string()
      .optional()
      .describe('Internal existence marker (empty string when present)'),
    '@hasRecipient': z
      .array(z.string())
      .optional()
      .describe(
        'Recipient references in format "native_contact : email@example.com"',
      ),
    '@content': z
      .array(z.string())
      .optional()
      .describe('Content page reference in format "native_page : uuid"'),
    '@parent': z
      .array(z.string())
      .optional()
      .describe('Parent thread reference in format "native_thread : uuid"'),
    sharedWithUsers: z
      .array(z.string())
      .optional()
      .describe('User UUIDs this draft is shared with'),
    mzTimestamp: z
      .number()
      .optional()
      .describe('Materialize DB internal timestamp'),
    createdAt: z.string().describe('ISO timestamp when created'),
    updatedAt: z.string().describe('ISO timestamp when last updated'),
  })
  .passthrough()
  .describe(
    'Email draft record. Key fields: objectId (UUID), _email/subject, _email/from, _status, @hasRecipient (recipients), createdAt, updatedAt',
  );

export const DraftEmailPropertiesSchema = z
  .object({
    subject: z.string().nullable().optional().describe('Email subject line'),
    to: z
      .array(z.string())
      .nullable()
      .optional()
      .describe('Recipient email addresses'),
    from: z.string().nullable().optional().describe('Sender email address'),
    cc: z
      .array(z.string())
      .nullable()
      .optional()
      .describe('CC email addresses'),
    bcc: z
      .array(z.string())
      .nullable()
      .optional()
      .describe('BCC email addresses'),
  })
  .describe('Structured email properties from GraphQL Draft type');

export const DraftDetailSchema = z
  .object({
    id: z.string().describe('Draft UUID'),
    type: z
      .string()
      .optional()
      .describe('Draft type identifier (e.g., "CONVERSATION")'),
    status: z
      .string()
      .nullable()
      .optional()
      .describe(
        'Draft status (e.g., "DRAFT", "SENDING", "SENT", "FAILED"). Null when status is unknown.',
      ),
    channel: z
      .string()
      .optional()
      .describe(
        'Communication channel for this draft (e.g., "EMAIL"). Always returned in base query.',
      ),
    workspaceId: z.string().describe('Workspace UUID'),
    createdAt: z.string().describe('ISO timestamp when created'),
    updatedAt: z.string().describe('ISO timestamp when last updated'),
    email: DraftEmailPropertiesSchema.nullable()
      .optional()
      .describe(
        'Structured email properties (subject, to, from, cc, bcc). Only included when includeEmail is true.',
      ),
    page: PageDetailSchema.nullable()
      .optional()
      .describe(
        'Full page content backing this draft. Only included when includePage is true.',
      ),
    parent: PageParentObjectSchema.nullable()
      .optional()
      .describe('Parent CRM object this draft is attached to'),
  })
  .describe('Detailed draft record from GraphQL workspaceDraft query');

// ============================================================================
// Function Schemas
// ============================================================================

export const listPagesSchema = {
  name: 'listPages',
  description:
    'List all pages in the workspace. Returns page records with title, creator, and timestamps.',
  notes: '',
  input: z.object({
    accessToken: AccessTokenParam,
    workspaceId: WorkspaceIdParam,
    limit: z
      .number()
      .optional()
      .default(100)
      .describe('Max pages to return (default 100). Clamped to 1–10000.'),
    offset: z
      .string()
      .optional()
      .default('1970-01-01T00:00:00.000Z')
      .describe(
        'Pagination offset as ISO timestamp (createdAt >= offset, inclusive). To paginate, add 1ms to the createdAt of the last item. Results ordered by createdAt ascending.',
      ),
  }),
  output: z.object({
    pages: z.array(PageSchema).describe('Array of page records'),
  }),
};

export const getPageSchema = {
  name: 'getPage',
  description:
    'Get full page content by page UUID, including body as JSON and HTML. Returns the complete page detail with metadata, linked CRM objects, and optionally authorization info.',
  notes:
    'The page response includes parentObject (if attached to a CRM record), crmObjects (linked contacts/orgs), AI generation metadata, and source template info. Authorization data (sharing settings and user access levels) is only included when includeAuthorization is true. The domains and actionIds fields are always returned. Instructions (AI context entries) are only included when includeInstructions is true and return null when none exist.',
  input: z.object({
    accessToken: AccessTokenParam,
    workspaceId: WorkspaceIdParam,
    pageId: z.string().describe('Page UUID (the objectId from listPages)'),
    includeAuthorization: z
      .boolean()
      .optional()
      .describe(
        'Include authorization data (workspace sharing status and per-user access levels). Adds a sub-query to the GraphQL request.',
      ),
    includeInstructions: z
      .boolean()
      .optional()
      .describe(
        'Include AI instruction/context entries linked to this page (WorkspaceUserContext objects with id, userId, workspaceId, pageTitle, createdAt, updatedAt). Returns null when no instructions exist.',
      ),
  }),
  output: z.object({
    page: PageDetailSchema.describe('Full page record with content'),
  }),
};

export const createPageSchema = {
  name: 'createPage',
  description:
    'Create a new page in the workspace. Returns the created page with its assigned UUID.',
  notes:
    'The page can optionally be linked to a parent object (e.g., calendar event) and CRM objects (contacts, organizations). The aiInitialPrompt field triggers server-side AI content generation. Use templateType to create template pages for email, Slack, etc.',
  input: z.object({
    accessToken: AccessTokenParam,
    workspaceId: WorkspaceIdParam,
    title: z.string().describe('Page title'),
    contentJson: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Page body as Tiptap JSON. If omitted, defaults to an empty document.',
      ),
    contentHtml: z
      .string()
      .optional()
      .describe(
        'Page body as HTML. Should match contentJson when both provided.',
      ),
    templateType: z
      .enum(['EMAIL', 'SLACK', 'INTERNAL_PAGE', 'KNOWLEDGE'])
      .optional()
      .describe(
        'Template type for this page. EMAIL = email template, SLACK = Slack message template, INTERNAL_PAGE = internal doc template, KNOWLEDGE = knowledge base template.',
      ),
    emoji: z
      .string()
      .optional()
      .describe('Emoji icon for the page (e.g., "rocket", "star").'),
    headerImage: z
      .string()
      .optional()
      .describe('URL for the page header image.'),
    ownerEmail: z
      .string()
      .optional()
      .describe(
        'Email address of the page owner. Defaults to the authenticated user.',
      ),
    publishedForUserAt: z
      .string()
      .optional()
      .describe(
        'ISO timestamp marking when the page was published for the user. Set to current time to publish immediately.',
      ),
    madeExternalAt: z
      .string()
      .optional()
      .describe(
        'ISO timestamp marking when the page was made publicly accessible via external link. Set to make the page public.',
      ),
    aiInitialPrompt: z
      .string()
      .optional()
      .describe(
        'AI prompt for server-side content generation. The server will use this prompt to auto-populate the page content asynchronously.',
      ),
    sourceTemplateId: z
      .string()
      .optional()
      .describe(
        'UUID of the template page to create from. Links the new page to its source template.',
      ),
    objectType: z
      .string()
      .optional()
      .describe(
        'Parent object type to attach the page to (e.g., "native_calendarevent", "native_contact"). Used with objectId.',
      ),
    objectId: z
      .string()
      .optional()
      .describe(
        'Parent object ID to attach the page to. Used with objectType.',
      ),
    crmObjects: z
      .array(
        z.object({
          objectType: z
            .string()
            .describe(
              'CRM object type (e.g., "native_contact", "native_organization", "native_calendarevent").',
            ),
          objectId: z.string().describe('CRM object ID.'),
        }),
      )
      .optional()
      .describe(
        'Array of CRM objects to link to this page. Each entry specifies a type and ID.',
      ),
  }),
  output: z.object({
    page: PageDetailSchema.describe('The newly created page'),
  }),
};

export const updatePageSchema = {
  name: 'updatePage',
  description:
    'Update an existing page by its UUID. Can modify title, content, emoji, header image, sharing visibility, template type, short link hash, and linked CRM objects.',
  notes:
    'Nullable fields (emoji, headerImage, madeExternalAt, publishedForUserAt, templateType) accept null to clear the value. The crmObjects array replaces the current set; pass the full desired list each time. Empty arrays are silently ignored by the backend (existing links remain). The mutation response always returns crmObjects as null regardless of actual state; use getPage to verify linked objects after updating.',
  input: z.object({
    accessToken: AccessTokenParam,
    workspaceId: WorkspaceIdParam,
    pageId: z
      .string()
      .describe('Page UUID (the objectId from listPages or id from getPage)'),
    title: z.string().optional().describe('New page title'),
    contentJson: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('New page body as Tiptap JSON'),
    contentHtml: z
      .string()
      .optional()
      .describe(
        'New page body as HTML. Should match contentJson when both provided.',
      ),
    emoji: z
      .string()
      .nullable()
      .optional()
      .describe('Page emoji icon (e.g., "🚀"). Pass null to remove the emoji.'),
    headerImage: z
      .string()
      .nullable()
      .optional()
      .describe('Header image URL for the page. Pass null to remove.'),
    madeExternalAt: z
      .string()
      .nullable()
      .optional()
      .describe(
        'ISO timestamp when the page was made publicly accessible. Set to a timestamp to make public, or null to make private.',
      ),
    templateType: z
      .enum(['EMAIL', 'KNOWLEDGE', 'SLACK'])
      .nullable()
      .optional()
      .describe(
        'Convert the page to a template of the given type. Pass null to revert to a regular page.',
      ),
    publishedForUserAt: z
      .string()
      .nullable()
      .optional()
      .describe(
        'ISO timestamp when the page was published for the user. Pass null to unpublish.',
      ),
    shortLinkHash: z
      .string()
      .optional()
      .describe('Custom short link hash for the page sharing URL.'),
    crmObjects: z
      .array(
        z.object({
          objectId: z
            .string()
            .describe(
              'CRM object ID (e.g., email for contacts, domain for organizations)',
            ),
          objectType: z
            .string()
            .describe(
              'CRM object type (e.g., "native_contact", "native_organization")',
            ),
          workspaceId: z
            .string()
            .optional()
            .describe(
              'Workspace UUID. Defaults to the page workspace if omitted.',
            ),
        }),
      )
      .optional()
      .describe(
        'CRM objects (contacts, organizations) to link to this page. Replaces the current set of linked objects. Must contain at least one entry; empty arrays are silently ignored by the backend.',
      ),
  }),
  output: z.object({
    page: PageDetailSchema.describe('The updated page'),
  }),
};

export const deletePageSchema = {
  name: 'deletePage',
  description: 'Permanently delete a page by its UUID.',
  notes: '',
  input: z.object({
    accessToken: AccessTokenParam,
    workspaceId: WorkspaceIdParam,
    pageId: z
      .string()
      .describe('Page UUID (the objectId from listPages or id from getPage)'),
  }),
  output: z.object({
    id: z.string().describe('UUID of the deleted page'),
  }),
};

export const listDraftsSchema = {
  name: 'listDrafts',
  description:
    'List all email drafts in the workspace. Returns draft records with subject, sender, recipients, status, and timestamps.',
  notes:
    'Drafts are created via the Day AI assistant or sendEmail. The subject is in `_email/subject`, sender in `_email/from`, and recipients in `@hasRecipient` (array of "native_contact : email" strings). Status values are uppercase: DRAFT, SENDING, SENT, FAILED. The API does not support server-side filtering or sorting; fetch all drafts and filter client-side. Results are ordered by createdAt ascending.',
  input: z.object({
    accessToken: AccessTokenParam,
    workspaceId: WorkspaceIdParam,
    limit: z
      .number()
      .optional()
      .default(100)
      .describe(
        'Max drafts to return (1–10000, default 100). Values outside this range fall back to the server default.',
      ),
    offset: z
      .string()
      .optional()
      .default('1970-01-01T00:00:00.000Z')
      .describe(
        'Pagination offset as ISO timestamp (createdAt >= offset, inclusive). Use createdAt from last item for next page. Results ordered by createdAt ascending.',
      ),
  }),
  output: z.object({
    drafts: z.array(DraftSchema).describe('Array of email draft records'),
  }),
};

export const getDraftSchema = {
  name: 'getDraft',
  description:
    'Get a single email draft by its UUID. Uses a direct GraphQL lookup instead of fetching all drafts. Optionally includes structured email properties and full page content.',
  notes:
    'Uses the GraphQL workspaceDraft query for direct lookup by ID. The base response includes id, type, status, timestamps, and parent object. Use includeEmail to get structured email fields (subject, to, from, cc, bcc). Use includePage to get the full backing page content (title, contentJson, contentHtml, etc.). Use includeAuthorization with includePage to get page sharing settings. IMPORTANT: In parentObject and crmObjects, Day.ai returns objectId/objectType swapped; objectId contains the type string (e.g., "native_draft") and objectType contains the UUID.',
  input: z.object({
    accessToken: AccessTokenParam,
    workspaceId: WorkspaceIdParam,
    draftId: z.string().describe('Draft UUID (the objectId from listDrafts)'),
    includeEmail: z
      .boolean()
      .optional()
      .describe(
        'Include structured email properties (subject, to, from, cc, bcc) in the response. These are parsed fields from the GraphQL Draft.email sub-object.',
      ),
    includePage: z
      .boolean()
      .optional()
      .describe(
        'Include full page content backing this draft (title, contentJson, contentHtml, emoji, etc.). Drafts are backed by Page objects in Day.ai.',
      ),
    includeAuthorization: z
      .boolean()
      .optional()
      .describe(
        'Include page authorization data (workspace sharing status and per-user access levels). Only effective when includePage is true.',
      ),
  }),
  output: z.object({
    draft: DraftDetailSchema.describe('Detailed draft record from GraphQL'),
  }),
};

export const sendEmailSchema = {
  name: 'sendEmail',
  description:
    'Send an email via the connected Gmail account. Automatically looks up the connected work account using the authenticated user email.',
  notes:
    'Requires a Gmail account to be connected in Day.ai workspace settings. The sender is determined by the connected work account. The body field accepts HTML content. BCC is not supported by the Day.ai API.',
  input: z.object({
    accessToken: AccessTokenParam,
    workspaceId: WorkspaceIdParam,
    email: z
      .string()
      .describe(
        'Authenticated user email from getContext(). Used to look up the connected Gmail work account.',
      ),
    to: z.array(z.string()).describe('Recipient email addresses'),
    subject: z.string().describe('Email subject line'),
    body: z.string().describe('Email body content (HTML supported)'),
    cc: z.array(z.string()).optional().describe('CC recipient email addresses'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the email was sent successfully'),
    fromEmail: z
      .string()
      .describe(
        'Email address the message was sent from (connected Gmail account)',
      ),
  }),
};

// ============================================================================
// Type Exports
// ============================================================================

export type Page = z.infer<typeof PageSchema>;
export type PageDetail = z.infer<typeof PageDetailSchema>;
export type WorkspaceUserContext = z.infer<typeof WorkspaceUserContextSchema>;
export type Draft = z.infer<typeof DraftSchema>;
export type DraftEmailProperties = z.infer<typeof DraftEmailPropertiesSchema>;
export type DraftDetail = z.infer<typeof DraftDetailSchema>;

export type ListPagesInput = z.infer<typeof listPagesSchema.input>;
export type ListPagesOutput = z.infer<typeof listPagesSchema.output>;
export type GetPageInput = z.infer<typeof getPageSchema.input>;
export type GetPageOutput = z.infer<typeof getPageSchema.output>;
export type CreatePageInput = z.infer<typeof createPageSchema.input>;
export type CreatePageOutput = z.infer<typeof createPageSchema.output>;
export type UpdatePageInput = z.infer<typeof updatePageSchema.input>;
export type UpdatePageOutput = z.infer<typeof updatePageSchema.output>;
export type DeletePageInput = z.infer<typeof deletePageSchema.input>;
export type DeletePageOutput = z.infer<typeof deletePageSchema.output>;
export type ListDraftsInput = z.infer<typeof listDraftsSchema.input>;
export type ListDraftsOutput = z.infer<typeof listDraftsSchema.output>;
export type GetDraftInput = z.infer<typeof getDraftSchema.input>;
export type GetDraftOutput = z.infer<typeof getDraftSchema.output>;
export type SendEmailInput = z.infer<typeof sendEmailSchema.input>;
export type SendEmailOutput = z.infer<typeof sendEmailSchema.output>;

// ============================================================================
// All Schemas
// ============================================================================

export const allPagesSchemas = [
  listPagesSchema,
  getPageSchema,
  createPageSchema,
  updatePageSchema,
  deletePageSchema,
  listDraftsSchema,
  getDraftSchema,
  sendEmailSchema,
];
