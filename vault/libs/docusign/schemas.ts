import { z } from 'zod';

export const libraryDescription =
  'DocuSign eSignature operations: send documents for signing using templates, manage envelopes, track signing status';

export const libraryIcon = '/icons/libs/docusign.ico';
export const loginUrl = 'https://apps.docusign.com';

export const libraryNotes = `
## Workflow

1. Navigate to \`apps.docusign.com/send/home\` (preferred starting page; keeps the session active and provides access to all envelope operations)
2. Call \`getContext()\` to extract accountId, userId, region, and API base URL
3. Use the returned \`apiBase\` for all subsequent operations

## Key Concepts

**Envelopes**: The core unit: a package of documents sent for signing. Created as "draft" (\`status: created\`), then sent (\`status: sent\`).

**Templates**: Reusable envelope blueprints with pre-configured documents, recipient roles, and signing fields. Create an envelope from a template, fill in recipients, and send.

**Recipients**: People who interact with an envelope. Types include \`signers\` (must sign), \`carbonCopies\` (get a copy). Each has a \`roleName\` from the template.

**Typical Send Flow**:
1. \`listTemplates()\` to find the right template
2. \`createEnvelopeFromTemplate()\` to create a draft envelope
3. \`getEnvelopeRecipients()\` to get the envelope's recipient IDs (these differ from the template's IDs)
4. \`updateEnvelopeRecipients()\` using the envelope's recipientIds to set names and emails
5. \`updateEnvelope()\` to set the email subject and message body
6. \`sendEnvelope()\` to send it

**Envelope Statuses**: \`created\` (draft), \`sent\` (awaiting signatures), \`delivered\` (viewed by recipient), \`completed\` (all signed), \`voided\` (cancelled), \`declined\` (recipient declined).

**Pagination**: Offset-based with \`startPosition\` (0-indexed offset) and \`count\` (page size, default 25).
`;

// ============================================================================
// Shared parameter schemas
// ============================================================================

const ApiBaseParam = z
  .string()
  .describe(
    'API base URL from getContext() (e.g. https://apps.docusign.com/api/esign/na4/restapi/v2.1/accounts/{accountId})',
  );

// ============================================================================
// Context
// ============================================================================

export const getContextSchema = {
  name: 'getContext',
  description:
    'Extract DocuSign session info from the page (call FIRST before any other function). Must be on apps.docusign.com.',
  notes: '',
  input: z.object({}),
  output: z.object({
    accountId: z.string().describe('DocuSign account ID (UUID)'),
    userId: z.string().describe('Current user ID (UUID)'),
    userName: z.string().describe('Current user display name'),
    email: z.string().describe('Current user email address'),
    region: z.string().describe('API region (e.g. na4)'),
    apiBase: z
      .string()
      .describe(
        'Full API base URL for all subsequent calls (e.g. https://apps.docusign.com/api/esign/na4/restapi/v2.1/accounts/{accountId})',
      ),
  }),
};
export type GetContextInput = z.infer<typeof getContextSchema.input>;
export type GetContextOutput = z.infer<typeof getContextSchema.output>;

// ============================================================================
// Templates
// ============================================================================

export const listTemplatesSchema = {
  name: 'listTemplates',
  description:
    'List available DocuSign templates with pagination. Returns template names, IDs, and metadata.',
  notes: '',
  input: z.object({
    apiBase: ApiBaseParam,
    startPosition: z
      .number()
      .optional()
      .default(0)
      .describe('Offset for pagination (default 0)'),
    count: z
      .number()
      .optional()
      .default(25)
      .describe('Number of templates per page (default 25)'),
    searchText: z.string().optional().describe('Filter templates by name'),
  }),
  output: z.object({
    templates: z.array(
      z.object({
        templateId: z.string(),
        name: z.string(),
        description: z.string().nullable(),
        lastModifiedDateTime: z.string(),
        createdDateTime: z.string(),
        shared: z.string(),
        folderId: z.string().nullable(),
        folderName: z.string().nullable(),
        owner: z
          .object({
            userName: z.string(),
            email: z.string(),
          })
          .passthrough(),
      }),
    ),
    totalSetSize: z.number(),
    resultSetSize: z.number(),
    startPosition: z.number(),
  }),
};
export type ListTemplatesInput = z.infer<typeof listTemplatesSchema.input>;
export type ListTemplatesOutput = z.infer<typeof listTemplatesSchema.output>;

export const getTemplateSchema = {
  name: 'getTemplate',
  description:
    'Get detailed information about a specific template including its documents, recipients/roles, and fields.',
  notes: '',
  input: z.object({
    apiBase: ApiBaseParam,
    templateId: z.string().describe('Template ID (UUID)'),
  }),
  output: z.object({
    templateId: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    documents: z.array(
      z.object({
        documentId: z.string(),
        name: z.string(),
        order: z.string(),
      }),
    ),
    recipients: z.object({
      signers: z.array(
        z.object({
          recipientId: z.string(),
          roleName: z.string(),
          routingOrder: z.string(),
          name: z.string(),
          email: z.string(),
        }),
      ),
      carbonCopies: z.array(
        z.object({
          recipientId: z.string(),
          roleName: z.string(),
          routingOrder: z.string(),
          name: z.string(),
          email: z.string(),
        }),
      ),
    }),
  }),
};
export type GetTemplateInput = z.infer<typeof getTemplateSchema.input>;
export type GetTemplateOutput = z.infer<typeof getTemplateSchema.output>;

// ============================================================================
// Envelopes
// ============================================================================

export const listEnvelopesSchema = {
  name: 'listEnvelopes',
  description:
    'List envelopes with optional status and date filters. Returns envelope IDs, subjects, statuses, and timestamps.',
  notes: '',
  input: z.object({
    apiBase: ApiBaseParam,
    fromDate: z
      .string()
      .optional()
      .describe(
        'ISO 8601 date string to filter from (default: 30 days ago). Example: 2024-01-01T00:00:00Z',
      ),
    status: z
      .string()
      .optional()
      .describe(
        'Filter by status. Comma-separated for multiple. Values: created, sent, delivered, completed, voided, declined',
      ),
    searchText: z
      .string()
      .optional()
      .describe('Search envelopes by subject or recipient'),
    startPosition: z
      .number()
      .optional()
      .default(0)
      .describe('Offset for pagination (default 0)'),
    count: z
      .number()
      .optional()
      .default(25)
      .describe('Number of envelopes per page (default 25)'),
  }),
  output: z.object({
    envelopes: z.array(
      z.object({
        envelopeId: z.string(),
        emailSubject: z.string().nullable(),
        status: z.string(),
        statusChangedDateTime: z.string(),
        createdDateTime: z.string(),
        sentDateTime: z.string().nullable(),
        completedDateTime: z.string().nullable(),
      }),
    ),
    totalSetSize: z.number(),
    resultSetSize: z.number(),
    startPosition: z.number(),
  }),
};
export type ListEnvelopesInput = z.infer<typeof listEnvelopesSchema.input>;
export type ListEnvelopesOutput = z.infer<typeof listEnvelopesSchema.output>;

export const getEnvelopeSchema = {
  name: 'getEnvelope',
  description:
    'Get detailed information about a specific envelope including its status, subject, and timestamps.',
  notes: '',
  input: z.object({
    apiBase: ApiBaseParam,
    envelopeId: z.string().describe('Envelope ID (UUID)'),
  }),
  output: z
    .object({
      envelopeId: z.string(),
      emailSubject: z.string().nullable(),
      emailBlurb: z.string().nullable(),
      status: z.string(),
      statusChangedDateTime: z.string(),
      createdDateTime: z.string(),
      sentDateTime: z.string().nullable(),
      completedDateTime: z.string().nullable(),
      voidedDateTime: z.string().nullable(),
      voidedReason: z.string().nullable(),
    })
    .passthrough(),
};
export type GetEnvelopeInput = z.infer<typeof getEnvelopeSchema.input>;
export type GetEnvelopeOutput = z.infer<typeof getEnvelopeSchema.output>;

export const createEnvelopeFromTemplateSchema = {
  name: 'createEnvelopeFromTemplate',
  description:
    'Create a new draft envelope from a template. Returns the new envelope ID. Use updateEnvelopeRecipients() and sendEnvelope() after.',
  notes:
    'Creates envelope in "created" (draft) status. The envelope gets NEW recipient IDs that differ from the template; call getEnvelopeRecipients() on the envelope to get the correct IDs before updating recipients.',
  input: z.object({
    apiBase: ApiBaseParam,
    templateId: z.string().describe('Template ID to create envelope from'),
    emailSubject: z
      .string()
      .optional()
      .describe('Email subject line (overrides template default)'),
    emailBlurb: z
      .string()
      .optional()
      .describe('Email body message to include with the envelope'),
  }),
  output: z.object({
    envelopeId: z.string().describe('The new envelope ID'),
    status: z.string().describe('Should be "created" for a draft'),
    uri: z.string(),
  }),
};
export type CreateEnvelopeFromTemplateInput = z.infer<
  typeof createEnvelopeFromTemplateSchema.input
>;
export type CreateEnvelopeFromTemplateOutput = z.infer<
  typeof createEnvelopeFromTemplateSchema.output
>;

export const updateEnvelopeSchema = {
  name: 'updateEnvelope',
  description:
    'Update envelope properties like email subject, email body message, or other settings. Does NOT send the envelope; use sendEnvelope() for that.',
  notes: 'Only works on envelopes in "created" (draft) status.',
  input: z.object({
    apiBase: ApiBaseParam,
    envelopeId: z.string().describe('Envelope ID to update'),
    emailSubject: z.string().optional().describe('New email subject line'),
    emailBlurb: z.string().optional().describe('New email body message'),
  }),
  output: z.object({
    envelopeId: z.string(),
  }),
};
export type UpdateEnvelopeInput = z.infer<typeof updateEnvelopeSchema.input>;
export type UpdateEnvelopeOutput = z.infer<typeof updateEnvelopeSchema.output>;

export const sendEnvelopeSchema = {
  name: 'sendEnvelope',
  description:
    'Send a draft envelope for signing. Changes the envelope status from "created" to "sent", triggering email delivery to all recipients.',
  notes:
    'Envelope must have all required recipients set before sending. Cannot undo; use voidEnvelope() to cancel after sending.',
  input: z.object({
    apiBase: ApiBaseParam,
    envelopeId: z.string().describe('Envelope ID to send'),
  }),
  output: z.object({
    envelopeId: z.string(),
  }),
};
export type SendEnvelopeInput = z.infer<typeof sendEnvelopeSchema.input>;
export type SendEnvelopeOutput = z.infer<typeof sendEnvelopeSchema.output>;

export const voidEnvelopeSchema = {
  name: 'voidEnvelope',
  description:
    'Void (cancel) an envelope that has been sent but not yet completed. Notifies all recipients that the envelope is cancelled.',
  notes: 'Only works on envelopes in "sent" or "delivered" status.',
  input: z.object({
    apiBase: ApiBaseParam,
    envelopeId: z.string().describe('Envelope ID to void'),
    voidedReason: z
      .string()
      .describe('Reason for voiding (required by DocuSign)'),
  }),
  output: z.object({
    envelopeId: z.string(),
  }),
};
export type VoidEnvelopeInput = z.infer<typeof voidEnvelopeSchema.input>;
export type VoidEnvelopeOutput = z.infer<typeof voidEnvelopeSchema.output>;

// ============================================================================
// Recipients
// ============================================================================

export const getEnvelopeRecipientsSchema = {
  name: 'getEnvelopeRecipients',
  description:
    'Get all recipients for an envelope: signers, carbon copies, and their signing status.',
  notes: '',
  input: z.object({
    apiBase: ApiBaseParam,
    envelopeId: z.string().describe('Envelope ID'),
  }),
  output: z.object({
    signers: z.array(
      z.object({
        recipientId: z.string(),
        name: z.string(),
        email: z.string(),
        roleName: z.string(),
        routingOrder: z.string(),
        status: z
          .string()
          .describe('created, sent, delivered, completed, declined'),
        deliveryMethod: z.string(),
      }),
    ),
    carbonCopies: z.array(
      z.object({
        recipientId: z.string(),
        name: z.string(),
        email: z.string(),
        roleName: z.string(),
        routingOrder: z.string(),
        status: z.string(),
      }),
    ),
    recipientCount: z.number(),
  }),
};
export type GetEnvelopeRecipientsInput = z.infer<
  typeof getEnvelopeRecipientsSchema.input
>;
export type GetEnvelopeRecipientsOutput = z.infer<
  typeof getEnvelopeRecipientsSchema.output
>;

export const updateEnvelopeRecipientsSchema = {
  name: 'updateEnvelopeRecipients',
  description:
    'Update recipients on a draft envelope: set their name and email for each role defined in the template.',
  notes:
    'IMPORTANT: Call getEnvelopeRecipients() on the ENVELOPE first to get its recipientIds. Envelope recipient IDs differ from template recipient IDs; using template IDs will create duplicate recipients instead of updating existing ones, causing a DUPLICATE_RECIPIENTS error on send.',
  input: z.object({
    apiBase: ApiBaseParam,
    envelopeId: z.string().describe('Envelope ID'),
    signers: z
      .array(
        z.object({
          recipientId: z
            .string()
            .describe(
              'Recipient ID from getEnvelopeRecipients() called on the ENVELOPE (not from getTemplate; those IDs are different)',
            ),
          name: z.string().describe('Signer full name'),
          email: z.string().describe('Signer email address'),
          roleName: z
            .string()
            .optional()
            .describe('Role name from the template'),
        }),
      )
      .describe('Signers to update'),
    carbonCopies: z
      .array(
        z.object({
          recipientId: z.string(),
          name: z.string(),
          email: z.string(),
          roleName: z.string().optional(),
        }),
      )
      .optional()
      .describe('Carbon copy recipients to update'),
  }),
  output: z.object({
    signers: z.array(
      z.object({
        recipientId: z.string(),
        name: z.string(),
        email: z.string(),
      }),
    ),
  }),
};
export type UpdateEnvelopeRecipientsInput = z.infer<
  typeof updateEnvelopeRecipientsSchema.input
>;
export type UpdateEnvelopeRecipientsOutput = z.infer<
  typeof updateEnvelopeRecipientsSchema.output
>;

// ============================================================================
// Documents
// ============================================================================

export const getEnvelopeDocumentsSchema = {
  name: 'getEnvelopeDocuments',
  description:
    'Get the list of documents attached to an envelope, including document IDs, names, and page counts.',
  notes: '',
  input: z.object({
    apiBase: ApiBaseParam,
    envelopeId: z.string().describe('Envelope ID'),
  }),
  output: z.object({
    envelopeId: z.string(),
    documents: z.array(
      z.object({
        documentId: z.string(),
        name: z.string(),
        type: z.string().describe('content, summary, etc.'),
        order: z.string(),
        pages: z
          .array(
            z.object({
              pageId: z.string(),
              sequence: z.string(),
              height: z.string(),
              width: z.string(),
            }),
          )
          .optional(),
      }),
    ),
  }),
};
export type GetEnvelopeDocumentsInput = z.infer<
  typeof getEnvelopeDocumentsSchema.input
>;
export type GetEnvelopeDocumentsOutput = z.infer<
  typeof getEnvelopeDocumentsSchema.output
>;

// ============================================================================
// Notifications
// ============================================================================

export const getEnvelopeNotificationSchema = {
  name: 'getEnvelopeNotification',
  description:
    'Get reminder and expiration notification settings for an envelope.',
  notes: '',
  input: z.object({
    apiBase: ApiBaseParam,
    envelopeId: z.string().describe('Envelope ID'),
  }),
  output: z.object({
    reminders: z.object({
      reminderEnabled: z.string(),
      reminderDelay: z.string().describe('Days before first reminder'),
      reminderFrequency: z.string().describe('Days between reminders'),
    }),
    expirations: z.object({
      expireEnabled: z.string(),
      expireAfter: z.string().describe('Days until envelope expires'),
      expireWarn: z.string().describe('Days before expiration to warn'),
    }),
  }),
};
export type GetEnvelopeNotificationInput = z.infer<
  typeof getEnvelopeNotificationSchema.input
>;
export type GetEnvelopeNotificationOutput = z.infer<
  typeof getEnvelopeNotificationSchema.output
>;

export const updateEnvelopeNotificationSchema = {
  name: 'updateEnvelopeNotification',
  description:
    'Update reminder and expiration notification settings for an envelope.',
  notes: 'Only works on draft envelopes (status: created).',
  input: z.object({
    apiBase: ApiBaseParam,
    envelopeId: z.string().describe('Envelope ID'),
    reminderEnabled: z
      .boolean()
      .optional()
      .describe('Enable/disable reminders'),
    reminderDelay: z
      .number()
      .optional()
      .describe('Days before first reminder (e.g. 3)'),
    reminderFrequency: z
      .number()
      .optional()
      .describe('Days between reminders (e.g. 5)'),
    expireEnabled: z.boolean().optional().describe('Enable/disable expiration'),
    expireAfter: z
      .number()
      .optional()
      .describe('Days until envelope expires (e.g. 120)'),
    expireWarn: z
      .number()
      .optional()
      .describe('Days before expiration to warn (e.g. 3)'),
  }),
  output: z.object({
    reminders: z.object({
      reminderEnabled: z.string(),
      reminderDelay: z.string(),
      reminderFrequency: z.string(),
    }),
    expirations: z.object({
      expireEnabled: z.string(),
      expireAfter: z.string(),
      expireWarn: z.string(),
    }),
  }),
};
export type UpdateEnvelopeNotificationInput = z.infer<
  typeof updateEnvelopeNotificationSchema.input
>;
export type UpdateEnvelopeNotificationOutput = z.infer<
  typeof updateEnvelopeNotificationSchema.output
>;

// ============================================================================
// Custom Fields
// ============================================================================

export const getEnvelopeCustomFieldsSchema = {
  name: 'getEnvelopeCustomFields',
  description:
    'Get custom metadata fields on an envelope (e.g., envelope type labels).',
  notes: '',
  input: z.object({
    apiBase: ApiBaseParam,
    envelopeId: z.string().describe('Envelope ID'),
  }),
  output: z.object({
    textCustomFields: z.array(
      z.object({
        fieldId: z.string(),
        name: z.string(),
        value: z.string(),
        required: z.string(),
        show: z.string(),
      }),
    ),
    listCustomFields: z.array(z.object({}).passthrough()),
  }),
};
export type GetEnvelopeCustomFieldsInput = z.infer<
  typeof getEnvelopeCustomFieldsSchema.input
>;
export type GetEnvelopeCustomFieldsOutput = z.infer<
  typeof getEnvelopeCustomFieldsSchema.output
>;

// ============================================================================
// Contacts
// ============================================================================

export const listContactsSchema = {
  name: 'listContacts',
  description:
    "List contacts from the DocuSign address book. Returns names and email addresses of people you've sent envelopes to.",
  notes: '',
  input: z.object({
    apiBase: ApiBaseParam,
  }),
  output: z.object({
    contacts: z.array(
      z.object({
        contactId: z.string(),
        name: z.string(),
        emails: z.array(z.string()),
        organization: z.string().nullable(),
      }),
    ),
    totalCount: z.number(),
  }),
};
export type ListContactsInput = z.infer<typeof listContactsSchema.input>;
export type ListContactsOutput = z.infer<typeof listContactsSchema.output>;

export const addContactsSchema = {
  name: 'addContacts',
  description:
    'Add one or more contacts to the DocuSign address book for easy recipient lookup.',
  notes: '',
  input: z.object({
    apiBase: ApiBaseParam,
    contacts: z.array(
      z.object({
        name: z.string().describe('Contact full name'),
        emails: z.array(z.string()).describe('Contact email addresses'),
        organization: z
          .string()
          .optional()
          .describe('Company/organization name'),
      }),
    ),
  }),
  output: z.object({
    contactsAdded: z.number(),
  }),
};
export type AddContactsInput = z.infer<typeof addContactsSchema.input>;
export type AddContactsOutput = z.infer<typeof addContactsSchema.output>;

// ============================================================================
// Users
// ============================================================================

export const listUsersSchema = {
  name: 'listUsers',
  description:
    'List users in the DocuSign account. Returns user names, emails, and status.',
  notes: '',
  input: z.object({
    apiBase: ApiBaseParam,
  }),
  output: z.object({
    users: z.array(
      z.object({
        userId: z.string(),
        userName: z.string(),
        email: z.string(),
        userStatus: z.string(),
        uri: z.string(),
      }),
    ),
    totalSetSize: z.number(),
  }),
};
export type ListUsersInput = z.infer<typeof listUsersSchema.input>;
export type ListUsersOutput = z.infer<typeof listUsersSchema.output>;

// ============================================================================
// Folders
// ============================================================================

export const listFoldersSchema = {
  name: 'listFolders',
  description:
    'List envelope folders in the account (e.g., Drafts, Sent Items, Inbox, etc.).',
  notes: '',
  input: z.object({
    apiBase: ApiBaseParam,
  }),
  output: z.object({
    folders: z.array(
      z.object({
        folderId: z.string(),
        name: z.string(),
        type: z.string().nullable(),
        itemCount: z.string().nullable(),
      }),
    ),
    totalSetSize: z.number(),
  }),
};
export type ListFoldersInput = z.infer<typeof listFoldersSchema.input>;
export type ListFoldersOutput = z.infer<typeof listFoldersSchema.output>;

// ============================================================================
// Template management
// ============================================================================

export const createTemplateSchema = {
  name: 'createTemplate',
  description:
    'Create a new empty template. Returns the new template ID. Add recipients with addTemplateRecipients() and tabs with addTemplateTabs() after creation.',
  notes:
    'Creates a blank template with no documents or recipients. Use uploadTemplateDocument() to add a document, addTemplateRecipients() for signer roles, and addTemplateTabs() for signing fields.',
  input: z.object({
    apiBase: ApiBaseParam,
    name: z.string().describe('Template name'),
    description: z.string().optional().describe('Template description'),
    emailSubject: z
      .string()
      .optional()
      .describe(
        'Default email subject line for envelopes created from this template',
      ),
  }),
  output: z.object({
    templateId: z.string().describe('The new template ID (UUID)'),
    name: z.string(),
    uri: z.string(),
  }),
};
export type CreateTemplateInput = z.infer<typeof createTemplateSchema.input>;
export type CreateTemplateOutput = z.infer<typeof createTemplateSchema.output>;

export const updateTemplateSchema = {
  name: 'updateTemplate',
  description:
    'Update template metadata: name, description, or default email subject.',
  notes: '',
  input: z.object({
    apiBase: ApiBaseParam,
    templateId: z.string().describe('Template ID to update'),
    name: z.string().optional().describe('New template name'),
    description: z.string().optional().describe('New template description'),
    emailSubject: z.string().optional().describe('New default email subject'),
  }),
  output: z.object({
    templateId: z.string(),
  }),
};
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema.input>;
export type UpdateTemplateOutput = z.infer<typeof updateTemplateSchema.output>;

export const addTemplateRecipientsSchema = {
  name: 'addTemplateRecipients',
  description:
    'Add signer roles to a template. Each role defines a placeholder recipient (name/email are placeholders; real values are set when creating an envelope from the template).',
  notes:
    'Use getTemplateRecipients() to check existing roles before adding. recipientId must be unique per recipient (e.g., "1", "2").',
  input: z.object({
    apiBase: ApiBaseParam,
    templateId: z.string().describe('Template ID'),
    signers: z
      .array(
        z.object({
          name: z
            .string()
            .describe('Placeholder name for the role (e.g., "Signer 1")'),
          email: z
            .string()
            .describe(
              'Placeholder email for the role (e.g., "signer1@example.com")',
            ),
          roleName: z
            .string()
            .describe(
              'Role name used when filling the template (e.g., "Buyer", "Seller")',
            ),
          routingOrder: z
            .string()
            .describe('Signing order (e.g., "1" for first, "2" for second)'),
          recipientId: z
            .string()
            .describe(
              'Unique recipient ID within this template (e.g., "1", "2")',
            ),
        }),
      )
      .describe('Signer roles to add'),
  }),
  output: z.object({
    signers: z.array(
      z.object({
        recipientId: z.string(),
        roleName: z.string(),
        routingOrder: z.string(),
        name: z.string(),
        email: z.string(),
      }),
    ),
  }),
};
export type AddTemplateRecipientsInput = z.infer<
  typeof addTemplateRecipientsSchema.input
>;
export type AddTemplateRecipientsOutput = z.infer<
  typeof addTemplateRecipientsSchema.output
>;

export const getTemplateRecipientsSchema = {
  name: 'getTemplateRecipients',
  description:
    'Get the recipient roles defined on a template. Returns signer and carbon copy roles with their IDs and routing order.',
  notes: '',
  input: z.object({
    apiBase: ApiBaseParam,
    templateId: z.string().describe('Template ID'),
  }),
  output: z.object({
    signers: z.array(
      z.object({
        recipientId: z.string(),
        name: z.string(),
        email: z.string(),
        roleName: z.string(),
        routingOrder: z.string(),
      }),
    ),
    carbonCopies: z.array(
      z.object({
        recipientId: z.string(),
        name: z.string(),
        email: z.string(),
        roleName: z.string(),
        routingOrder: z.string(),
      }),
    ),
    recipientCount: z.number(),
  }),
};
export type GetTemplateRecipientsInput = z.infer<
  typeof getTemplateRecipientsSchema.input
>;
export type GetTemplateRecipientsOutput = z.infer<
  typeof getTemplateRecipientsSchema.output
>;

export const addTemplateTabsSchema = {
  name: 'addTemplateTabs',
  description:
    'Add signature/date/text/name/company/title fields (tabs) to a template recipient. Tabs define where signers interact with the document.',
  notes:
    'Call getTemplateRecipients() first to get recipientId. Tab position is set via xPosition/yPosition (pixels from top-left of page) or anchorString (finds text in the document and places tab relative to it). Prefer anchorString when the document has reliable anchor text.',
  input: z.object({
    apiBase: ApiBaseParam,
    templateId: z.string().describe('Template ID'),
    recipientId: z
      .string()
      .describe('Recipient ID from getTemplateRecipients()'),
    signHereTabs: z
      .array(
        z.object({
          documentId: z.string().describe('Document ID to place the tab on'),
          pageNumber: z.string().describe('Page number (1-indexed)'),
          xPosition: z
            .string()
            .optional()
            .describe('Horizontal position in pixels from left edge'),
          yPosition: z
            .string()
            .optional()
            .describe('Vertical position in pixels from top edge'),
          anchorString: z
            .string()
            .optional()
            .describe('Text in the document to anchor the tab to'),
          anchorXOffset: z
            .string()
            .optional()
            .describe('Horizontal offset from anchor text in pixels'),
          anchorYOffset: z
            .string()
            .optional()
            .describe('Vertical offset from anchor text in pixels'),
        }),
      )
      .optional()
      .describe('Signature fields'),
    dateSignedTabs: z
      .array(
        z.object({
          documentId: z.string(),
          pageNumber: z.string(),
          xPosition: z.string().optional(),
          yPosition: z.string().optional(),
          anchorString: z.string().optional(),
          anchorXOffset: z.string().optional(),
          anchorYOffset: z.string().optional(),
        }),
      )
      .optional()
      .describe('Auto-filled date-signed fields'),
    fullNameTabs: z
      .array(
        z.object({
          documentId: z.string(),
          pageNumber: z.string(),
          xPosition: z.string().optional(),
          yPosition: z.string().optional(),
          anchorString: z.string().optional(),
          anchorXOffset: z.string().optional(),
          anchorYOffset: z.string().optional(),
        }),
      )
      .optional()
      .describe('Auto-filled full name fields'),
    companyTabs: z
      .array(
        z.object({
          documentId: z.string(),
          pageNumber: z.string(),
          xPosition: z.string().optional(),
          yPosition: z.string().optional(),
          anchorString: z.string().optional(),
          anchorXOffset: z.string().optional(),
          anchorYOffset: z.string().optional(),
        }),
      )
      .optional()
      .describe('Auto-filled company name fields'),
    titleTabs: z
      .array(
        z.object({
          documentId: z.string(),
          pageNumber: z.string(),
          xPosition: z.string().optional(),
          yPosition: z.string().optional(),
          anchorString: z.string().optional(),
          anchorXOffset: z.string().optional(),
          anchorYOffset: z.string().optional(),
        }),
      )
      .optional()
      .describe('Auto-filled job title fields'),
    textTabs: z
      .array(
        z.object({
          documentId: z.string(),
          pageNumber: z.string(),
          tabLabel: z.string().describe('Label identifier for the text field'),
          xPosition: z.string().optional(),
          yPosition: z.string().optional(),
          anchorString: z.string().optional(),
          anchorXOffset: z.string().optional(),
          anchorYOffset: z.string().optional(),
          required: z
            .boolean()
            .optional()
            .describe('Whether the field must be filled before signing'),
        }),
      )
      .optional()
      .describe('Free-text input fields'),
  }),
  output: z.object({
    tabsAdded: z
      .number()
      .describe('Total number of tabs added across all tab types'),
  }),
};
export type AddTemplateTabsInput = z.infer<typeof addTemplateTabsSchema.input>;
export type AddTemplateTabsOutput = z.infer<
  typeof addTemplateTabsSchema.output
>;

export const uploadTemplateDocumentSchema = {
  name: 'uploadTemplateDocument',
  description:
    'Upload a document (PDF, DOCX, etc.) to a template. The document content must be base64-encoded. Use the files library to load the file from disk and convert to base64.',
  notes:
    'Load the file with files.load(), convert the ArrayBuffer to base64, then pass it here. documentId is typically "1" for the first/only document. If replacing an existing document, use the same documentId.',
  input: z.object({
    apiBase: ApiBaseParam,
    templateId: z.string().describe('Template ID to upload the document to'),
    documentId: z
      .string()
      .optional()
      .default('1')
      .describe('Document ID (default "1" for single-document templates)'),
    name: z
      .string()
      .describe('Filename with extension (e.g. "Contract.pdf", "MNDA.docx")'),
    fileExtension: z
      .string()
      .describe('File extension without dot (e.g. "pdf", "docx")'),
    documentBase64: z.string().describe('Base64-encoded file content'),
  }),
  output: z.object({
    documentId: z.string(),
    documentIdGuid: z.string(),
    name: z.string(),
    uri: z.string(),
  }),
};
export type UploadTemplateDocumentInput = z.infer<
  typeof uploadTemplateDocumentSchema.input
>;
export type UploadTemplateDocumentOutput = z.infer<
  typeof uploadTemplateDocumentSchema.output
>;

// ============================================================================
// Embedded signing
// ============================================================================

export const createEmbeddedSigningUrlSchema = {
  name: 'createEmbeddedSigningUrl',
  description:
    'Generate a URL for embedded (in-app) signing. The signer is redirected to this URL to sign the envelope within your application rather than via email.',
  notes:
    'The recipient must have been added with a clientUserId to enable embedded signing. clientUserId is an arbitrary string you set to identify the signer in your app; it must match the value used when creating the envelope recipient.',
  input: z.object({
    apiBase: ApiBaseParam,
    envelopeId: z.string().describe('Envelope ID'),
    returnUrl: z
      .string()
      .describe(
        'URL to redirect the signer to after signing (or declining/cancelling)',
      ),
    clientUserId: z
      .string()
      .describe(
        'Client-side user identifier set when the recipient was added. Must match exactly.',
      ),
    userName: z
      .string()
      .describe(
        'Signer full name (must match the recipient name on the envelope)',
      ),
    email: z
      .string()
      .describe(
        'Signer email address (must match the recipient email on the envelope)',
      ),
    recipientId: z
      .string()
      .describe('Recipient ID from getEnvelopeRecipients()'),
  }),
  output: z.object({
    url: z
      .string()
      .describe(
        'Signing URL to redirect the user to. Valid for a short time only.',
      ),
  }),
};
export type CreateEmbeddedSigningUrlInput = z.infer<
  typeof createEmbeddedSigningUrlSchema.input
>;
export type CreateEmbeddedSigningUrlOutput = z.infer<
  typeof createEmbeddedSigningUrlSchema.output
>;

// ============================================================================
// Signing (DANGEROUS)
// ============================================================================

export const signEnvelopeAsCurrentUserSchema = {
  name: 'signEnvelopeAsCurrentUser',
  description:
    'Generate a signing URL for the current account user to sign an envelope they are a recipient on. Returns a URL that must be navigated to in the browser to begin the signing ceremony.',
  notes:
    '⚠️ EXTREMELY DANGEROUS: DO NOT CALL THIS FUNCTION UNLESS THE USER HAS EXPLICITLY, AGGRESSIVELY, AND REPEATEDLY INSISTED THAT THEY WANT TO SIGN A DOCUMENT. This function initiates a LEGALLY BINDING signature on a real DocuSign envelope. Signing cannot be undone. NEVER call this proactively, never suggest it, and never call it without the user saying something like "sign it", "I want to sign", or "go ahead and sign". If in doubt, DO NOT CALL THIS. After calling this function, navigate the browser to the returned signingUrl, wait for the page to fully load (the URL will contain ti= parameter), then call completeSigningCeremony() to programmatically complete the signing.',
  input: z.object({
    apiBase: ApiBaseParam,
    envelopeId: z.string().describe('Envelope ID to sign'),
    userId: z.string().describe('Current user ID (UUID) from getContext()'),
    signerEmail: z
      .string()
      .describe(
        'Email of the signer (must match a recipient on the envelope). Use the email from getContext().',
      ),
  }),
  output: z.object({
    signingUrl: z
      .string()
      .describe(
        'URL to navigate the browser to for the signing ceremony. Valid for a short time only.',
      ),
    envelopeId: z.string(),
    recipientName: z.string().describe('Matched recipient name'),
    recipientEmail: z.string().describe('Matched recipient email'),
  }),
};
export type SignEnvelopeAsCurrentUserInput = z.infer<
  typeof signEnvelopeAsCurrentUserSchema.input
>;
export type SignEnvelopeAsCurrentUserOutput = z.infer<
  typeof signEnvelopeAsCurrentUserSchema.output
>;

export const completeSigningCeremonySchema = {
  name: 'completeSigningCeremony',
  description:
    'Programmatically complete the DocuSign signing ceremony after navigating to the signing URL. Must be called while the browser is on the signing ceremony page (URL contains ti= parameter).',
  notes:
    '⚠️ EXTREMELY DANGEROUS: DO NOT CALL THIS FUNCTION UNLESS THE USER HAS EXPLICITLY, AGGRESSIVELY, AND REPEATEDLY INSISTED THAT THEY WANT TO SIGN A DOCUMENT. This completes a LEGALLY BINDING signature. Call signEnvelopeAsCurrentUser() first to get the signing URL, navigate to it, wait for the page to load (URL must contain ti= parameter), then call this function. The function adopts a signature style, fills all required tabs, and finalizes the signing. This CANNOT be undone.',
  input: z.object({
    signerName: z
      .string()
      .describe(
        'Full name of the signer, used for signature adoption (e.g., "Bob Ross")',
      ),
    signerInitials: z
      .string()
      .optional()
      .describe(
        'Initials for initial tabs (e.g., "BR"). Auto-derived from signerName if not provided.',
      ),
    region: z
      .string()
      .optional()
      .default('na4')
      .describe('DocuSign API region (default na4)'),
  }),
  output: z.object({
    status: z.string().describe('Signing status: "completed" on success'),
    envelopeId: z.string().describe('The signed envelope ID'),
  }),
};
export type CompleteSigningCeremonyInput = z.infer<
  typeof completeSigningCeremonySchema.input
>;
export type CompleteSigningCeremonyOutput = z.infer<
  typeof completeSigningCeremonySchema.output
>;

// ============================================================================
// allSchemas export
// ============================================================================

export const allSchemas = [
  getContextSchema,
  listTemplatesSchema,
  getTemplateSchema,
  createTemplateSchema,
  updateTemplateSchema,
  addTemplateRecipientsSchema,
  getTemplateRecipientsSchema,
  addTemplateTabsSchema,
  uploadTemplateDocumentSchema,
  listEnvelopesSchema,
  getEnvelopeSchema,
  createEnvelopeFromTemplateSchema,
  updateEnvelopeSchema,
  sendEnvelopeSchema,
  voidEnvelopeSchema,
  getEnvelopeRecipientsSchema,
  updateEnvelopeRecipientsSchema,
  getEnvelopeDocumentsSchema,
  getEnvelopeNotificationSchema,
  updateEnvelopeNotificationSchema,
  getEnvelopeCustomFieldsSchema,
  createEmbeddedSigningUrlSchema,
  signEnvelopeAsCurrentUserSchema,
  completeSigningCeremonySchema,
  listContactsSchema,
  addContactsSchema,
  listUsersSchema,
  listFoldersSchema,
];
