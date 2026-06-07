import { z } from 'zod';

// ============================================================================
// Shared types
// ============================================================================

const TemplateSchema = z.object({
  id: z.string().describe('Template ID'),
  name: z.string().describe('Template name'),
  type: z
    .enum([
      'email',
      'call',
      'custom',
      'linkedin-message',
      'linkedin-connect-request',
    ])
    .optional()
    .describe('Template type'),
  subject: z
    .string()
    .describe(
      'Email subject line (empty string for non-email types like call, custom, linkedin-message)',
    ),
  body: z.string().describe('Email body content (HTML)'),
  folderId: z.number().describe('ID of the folder this template belongs to'),
  isDefault: z
    .boolean()
    .optional()
    .describe('Whether this is the default template for its type'),
  parentTemplateId: z
    .number()
    .nullable()
    .optional()
    .describe(
      'ID of the parent template if this is a variant/child, null for top-level templates',
    ),
  isFavorite: z
    .boolean()
    .optional()
    .describe('Whether the template is starred/favorited'),
  tagIds: z
    .array(z.string())
    .optional()
    .describe('Tag/list IDs assigned to the template'),
  jsonTemplate: z
    .object({
      type: z.string(),
      content: z.array(z.record(z.string(), z.unknown())).optional(),
    })
    .optional()
    .describe(
      'TipTap/ProseMirror JSON document representation of the template body. The API typically returns null for this field; it is omitted from output when null.',
    ),
  delivered: z
    .number()
    .optional()
    .describe('Number of times this template was delivered/sent'),
  replied: z
    .number()
    .optional()
    .describe('Number of times recipients replied to this template'),
  optedOut: z
    .number()
    .optional()
    .describe('Number of opt-outs associated with this template'),
  used: z
    .number()
    .optional()
    .describe('Total number of times this template has been used'),
  lastUsed: z
    .string()
    .nullable()
    .optional()
    .describe(
      'ISO 8601 timestamp when this template was last used, or null if never used',
    ),
});

export type Template = z.infer<typeof TemplateSchema>;

// ============================================================================
// listTemplates
// ============================================================================

export const listTemplatesSchema = {
  name: 'listTemplates',
  description:
    'List email templates across all folders. Optionally filter by type or search text. Supports pagination and sorting. Each template includes its folderId; use that to identify which folder it belongs to.',
  notes:
    'Requires orgId from getContext(). The API does not support server-side folder or tag filtering; all templates across all folders are returned. Use the folderId field on each template to group or filter client-side. Page is 1-indexed. Usage stats (delivered, replied, optedOut, used, lastUsed) are always included in the response.',
  input: z.object({
    orgId: z.string().describe('Organization ID from getContext()'),
    page: z.number().optional().describe('Page number (1-indexed). Default 1.'),
    limit: z.number().optional().describe('Results per page. Default 25.'),
    sortColumn: z
      .enum(['name', 'subject', 'createdAt', 'updatedAt', 'type'])
      .optional()
      .describe('Column to sort results by'),
    sortOrder: z
      .enum(['asc', 'desc'])
      .optional()
      .describe('Sort direction: asc or desc'),
    type: z
      .array(
        z.enum([
          'email',
          'call',
          'custom',
          'linkedin-message',
          'linkedin-connect-request',
        ]),
      )
      .optional()
      .describe(
        'Filter by template type. Valid values: email, call, custom, linkedin-message, linkedin-connect-request',
      ),
    searchText: z
      .string()
      .optional()
      .describe('Text search filter for template name or subject'),
  }),
  output: z.object({
    templates: z.array(TemplateSchema).describe('Templates across all folders'),
    count: z.number().describe('Total number of templates matching the query'),
    hasMore: z.boolean().describe('Whether there are more pages of results'),
  }),
};

export type ListTemplatesInput = z.infer<typeof listTemplatesSchema.input>;
export type ListTemplatesOutput = z.infer<typeof listTemplatesSchema.output>;

// ============================================================================
// createTemplate
// ============================================================================

export const createTemplateSchema = {
  name: 'createTemplate',
  description: 'Create a new email template in a specific folder.',
  notes:
    'Requires orgId from getContext() and folderId from listTemplateFolders(). templateType is sent as a query parameter (?type=). subject, body, and jsonTemplate are nested under data.subject, data.template, and data.jsonTemplate in the request body. jsonTemplate is the TipTap/ProseMirror JSON representation the UI auto-generates from HTML; it is optional and can be omitted when only HTML is available.',
  input: z.object({
    orgId: z.string().describe('Organization ID from getContext()'),
    templateType: z
      .enum([
        'email',
        'call',
        'custom',
        'linkedin-message',
        'linkedin-connect-request',
      ])
      .describe(
        'Template type (required by the API, sent as query param ?type=). Determines which folder type to create in.',
      ),
    folderId: z
      .number()
      .describe(
        'Folder ID from listTemplateFolders() (the templateFolderId field). Use the folder matching your templateType.',
      ),
    name: z.string().describe('Template name'),
    subject: z
      .string()
      .optional()
      .describe(
        'Email subject line. Only applicable for email type templates.',
      ),
    body: z.string().describe('Template body content (HTML supported)'),
    isFavorite: z
      .boolean()
      .optional()
      .describe('Whether to star/favorite the template. Default false.'),
    isDefault: z
      .boolean()
      .optional()
      .describe(
        'Whether to set as the default template for this type. Default false.',
      ),
    tagIds: z
      .array(z.string())
      .optional()
      .describe('Tag/list IDs to assign to the template. Default [].'),
    parentTemplateId: z
      .string()
      .optional()
      .describe('ID of a parent template (for template variants/children).'),
    jsonTemplate: z
      .object({
        type: z.string(),
        content: z.array(z.record(z.string(), z.unknown())).optional(),
      })
      .optional()
      .describe(
        'Optional TipTap/ProseMirror JSON document for the template body. The UI auto-generates this from the HTML body. If omitted, only the HTML body is sent. Sent inside the data object as data.jsonTemplate.',
      ),
  }),
  output: z.object({
    template: TemplateSchema.describe('The created template'),
  }),
};

export type CreateTemplateInput = z.infer<typeof createTemplateSchema.input>;
export type CreateTemplateOutput = z.infer<typeof createTemplateSchema.output>;

// ============================================================================
// updateTemplate
// ============================================================================

export const updateTemplateSchema = {
  name: 'updateTemplate',
  description:
    'Update an existing email template. Only provided fields are changed.',
  notes:
    'Requires orgId from getContext(). templateId and type both come from listTemplates(). The type is required by the API and sent as a query parameter. IMPORTANT: isFavorite always defaults to false if not provided. If the template is currently favorited and you want to keep it favorited, explicitly pass isFavorite: true. When isArchiving=true, the API returns only a success indicator (no template data); template will be absent from the output.',
  input: z.object({
    orgId: z.string().describe('Organization ID from getContext()'),
    templateId: z
      .string()
      .describe('Template ID to update (from listTemplates)'),
    type: z
      .enum([
        'email',
        'call',
        'custom',
        'linkedin-message',
        'linkedin-connect-request',
      ])
      .describe(
        'Template type (required by the API, sent as query param). Get this from the type field in listTemplates().',
      ),
    name: z.string().optional().describe('New template name'),
    subject: z.string().optional().describe('New email subject line'),
    body: z
      .string()
      .optional()
      .describe(
        'New email body content (HTML supported). Sent as data.template in the API.',
      ),
    templateFolderId: z
      .number()
      .optional()
      .describe(
        'Folder ID to move the template to. Get folderIds from listTemplateFolders().',
      ),
    tagIds: z
      .array(z.string())
      .optional()
      .describe('Tag/list IDs to assign to the template.'),
    isDefault: z
      .boolean()
      .optional()
      .describe('Set as the default template for this type.'),
    isFavorite: z
      .boolean()
      .optional()
      .describe('Whether the template is favorited (starred).'),
    isArchiving: z
      .boolean()
      .optional()
      .describe(
        'Set to true to archive/hide the template, false to unarchive. When true, the API returns no template data (only archived=true is returned).',
      ),
    parentTemplateId: z
      .string()
      .optional()
      .describe(
        'ID of a parent template (for template variants/children). Links this template as a child of the specified parent.',
      ),
  }),
  output: z.object({
    template: TemplateSchema.optional().describe(
      'The updated template. Absent when isArchiving=true (the API does not return template data for archive operations).',
    ),
    archived: z
      .boolean()
      .optional()
      .describe(
        'Present and true when isArchiving=true, confirming the archive succeeded.',
      ),
  }),
};

export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema.input>;
export type UpdateTemplateOutput = z.infer<typeof updateTemplateSchema.output>;

// ============================================================================
// deleteTemplate
// ============================================================================

export const deleteTemplateSchema = {
  name: 'deleteTemplate',
  description: 'Delete an email template by ID.',
  notes:
    'Requires orgId from getContext(). templateId and type both come from listTemplates(). The type is required by the API and sent as a query parameter.',
  input: z.object({
    orgId: z.string().describe('Organization ID from getContext()'),
    templateId: z
      .string()
      .describe('Template ID to delete (from listTemplates)'),
    type: z
      .enum([
        'email',
        'call',
        'custom',
        'linkedin-message',
        'linkedin-connect-request',
      ])
      .describe(
        'Template type (required by the API, sent as query param). Get this from the type field in listTemplates().',
      ),
  }),
  output: z.object({
    success: z
      .boolean()
      .describe('Whether the template was deleted successfully'),
  }),
};

export type DeleteTemplateInput = z.infer<typeof deleteTemplateSchema.input>;
export type DeleteTemplateOutput = z.infer<typeof deleteTemplateSchema.output>;

// ============================================================================
// allSchemas (for barrel import)
// ============================================================================

export const templatesSchemas = [
  listTemplatesSchema,
  createTemplateSchema,
  updateTemplateSchema,
  deleteTemplateSchema,
];
