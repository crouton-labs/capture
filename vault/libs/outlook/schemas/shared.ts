import { z } from 'zod';

// ============================================================================
// Auth
// ============================================================================

export const OutlookAuthSchema = z.object({
  authorization: z
    .string()
    .describe('MSAuth1.0 usertoken header for OWA authentication'),
  sessionId: z.string().describe('OWA session UUID'),
  anchorMailbox: z
    .string()
    .describe(
      'Mailbox routing anchor (SMTP:{email}). Used by Exchange to route requests to the correct backend.',
    ),
  correlationId: z.string().describe('Request correlation UUID'),
  canary: z
    .string()
    .describe(
      'X-OWA-CANARY anti-CSRF token. On personal accounts this is the server-accepted sentinel "X-OWA-CANARY_cookie_is_null_or_empty". Pass as-is.',
    ),
  timezone: z
    .string()
    .describe('User timezone ID (e.g., "Pacific Standard Time")'),
});

export const AuthParam = OutlookAuthSchema.describe(
  'Auth object from getContext(). Pass the entire object.',
);

// ============================================================================
// Email Entities
// ============================================================================

export const EmailAddressSchema = z.object({
  name: z.string().describe('Display name'),
  email: z.string().describe('Email address'),
});

export const EmailSummarySchema = z.object({
  itemId: z.string().describe('Immutable item ID'),
  conversationId: z.string().describe('Conversation thread ID'),
  subject: z.string().describe('Email subject line'),
  from: EmailAddressSchema.describe('Sender'),
  displayTo: z
    .string()
    .describe('Comma-separated display names of To recipients'),
  preview: z.string().describe('Body preview text'),
  receivedAt: z.string().describe('ISO 8601 received date'),
  sentAt: z.string().describe('ISO 8601 sent date'),
  isRead: z.boolean().describe('Whether the email has been read'),
  isDraft: z.boolean().describe('Whether the email is a draft'),
  hasAttachments: z.boolean().describe('Whether the email has attachments'),
  importance: z.string().describe('Importance level (Normal, High, Low)'),
  flagStatus: z
    .string()
    .describe('Flag status (NotFlagged, Flagged, Complete)'),
  inferenceClassification: z
    .string()
    .describe('Focused or Other (Focused Inbox classification)'),
});

export const EmailContentSchema = z.object({
  itemId: z.string().describe('Immutable item ID'),
  conversationId: z.string().describe('Conversation thread ID'),
  subject: z.string().describe('Email subject line'),
  from: EmailAddressSchema.describe('Sender'),
  toRecipients: z.array(EmailAddressSchema).describe('To recipients'),
  ccRecipients: z.array(EmailAddressSchema).describe('CC recipients'),
  bccRecipients: z.array(EmailAddressSchema).describe('BCC recipients'),
  body: z.string().describe('Email body as HTML'),
  bodyText: z.string().describe('Email body as plain text'),
  receivedAt: z.string().describe('ISO 8601 received date'),
  sentAt: z.string().describe('ISO 8601 sent date'),
  isRead: z.boolean().describe('Whether the email has been read'),
  hasAttachments: z.boolean().describe('Whether the email has attachments'),
  importance: z.string().describe('Importance level (Normal, High, Low)'),
  categories: z.array(z.string()).describe('Category labels'),
});

// ============================================================================
// Attachment Entities
// ============================================================================

export const AttachmentMetadataSchema = z.object({
  attachmentId: z
    .string()
    .describe(
      'Attachment ID. Pass to getAttachment() to download the content.',
    ),
  name: z.string().describe('Filename (e.g., "report.pdf")'),
  contentType: z
    .string()
    .describe('MIME type (e.g., "application/pdf", "image/png")'),
  size: z.number().describe('Attachment size in bytes'),
  isInline: z
    .boolean()
    .describe(
      'Whether the attachment is inline (embedded in the HTML body via cid: references)',
    ),
  contentId: z
    .string()
    .describe(
      'Content-ID for inline attachments (used in cid: references). Empty string for non-inline attachments.',
    ),
  lastModifiedTime: z
    .string()
    .describe('ISO 8601 date when the attachment was last modified'),
});

// ============================================================================
// Folder Entities
// ============================================================================

export const FolderSummarySchema = z.object({
  folderId: z.string().describe('Immutable folder ID'),
  displayName: z.string().describe('Folder display name'),
  unreadCount: z.number().describe('Number of unread items in this folder'),
  totalCount: z.number().describe('Total number of items in this folder'),
  childFolderCount: z.number().describe('Number of direct child sub-folders'),
  folderClass: z
    .string()
    .describe(
      'Folder class identifier. IPF.Note = mail folder, IPF.Task = tasks, IPF.Appointment = calendar',
    ),
});

// ============================================================================
// Contact Entities
// ============================================================================

export const ContactEmailSchema = z.object({
  address: z.string().describe('Email address'),
  displayName: z.string().describe('Display name for this email'),
  type: z
    .string()
    .describe('Email type (e.g., EmailAddress1, SMTP, BusinessEmail)'),
});

export const ContactPhoneSchema = z.object({
  number: z.string().describe('Phone number string'),
  type: z
    .string()
    .describe(
      'Phone type (e.g., BusinessPhone, MobilePhone, HomePhone, BusinessFax)',
    ),
});

export const ContactAddressSchema = z.object({
  street: z.string().describe('Street address'),
  city: z.string().describe('City'),
  state: z.string().describe('State or province'),
  postalCode: z.string().describe('Postal or ZIP code'),
  country: z.string().describe('Country or region'),
  postOfficeBox: z
    .string()
    .optional()
    .describe('P.O. Box number (empty string or absent if not set)'),
  type: z.string().describe('Address type (e.g., Business, Home)'),
});

export const ContactPositionSchema = z.object({
  company: z.string().describe('Company name'),
  title: z.string().describe('Job title at this position'),
  department: z.string().describe('Department at this position'),
  startDate: z.string().describe('Position start date (ISO 8601 or empty)'),
  endDate: z
    .string()
    .describe('Position end date (ISO 8601 or empty if current)'),
  isCurrent: z.boolean().describe('Whether this is the current position'),
});

export const ContactSummarySchema = z.object({
  id: z
    .string()
    .describe(
      'Contact ID. Pass as contactId to getContact() for full details.',
    ),
  displayName: z.string().describe('Full display name'),
  givenName: z.string().describe('First name'),
  surname: z.string().describe('Last name'),
  companyName: z.string().describe('Company name'),
  department: z.string().describe('Department'),
  jobTitle: z.string().describe('Job title'),
  emails: z.array(ContactEmailSchema).describe('Email addresses'),
  phones: z.array(ContactPhoneSchema).describe('Phone numbers'),
  addresses: z.array(ContactAddressSchema).describe('Postal addresses'),
  positions: z
    .array(ContactPositionSchema)
    .describe('Work history and current positions'),
  notes: z.string().describe('Personal notes about the contact (may be empty)'),
  photoUrl: z.string().describe('Profile photo URL (empty string if no photo)'),
});

export const ContactWebsiteSchema = z.object({
  webUrl: z.string().describe('Website URL'),
  displayName: z.string().describe('Display label for the website'),
  type: z
    .string()
    .describe('Website category (e.g., Personal, Business, or empty)'),
});

export const ContactRelationshipSchema = z.object({
  displayName: z.string().describe('Name of the related person'),
  relationship: z
    .string()
    .describe(
      'Relationship type (e.g., Manager, Assistant, Spouse, Child, Colleague)',
    ),
});

export const ContactWebAccountSchema = z.object({
  userId: z.string().describe('IM/chat user ID or address'),
  serviceName: z
    .string()
    .describe('IM service name (e.g., Skype, Teams, Unknown)'),
  serviceWebUrl: z
    .string()
    .describe('IM service web URL (empty string if unknown)'),
});

export const ContactTagSchema = z.object({
  id: z.string().describe('Tag ID'),
  displayName: z.string().describe('Tag display name'),
});

export const ContactDetailSchema = z.object({
  contactId: z.string().describe('Contact ID'),
  displayName: z.string().describe('Full display name'),
  givenName: z.string().describe('First name'),
  surname: z.string().describe('Last name'),
  middleName: z.string().describe('Middle name (empty string if not set)'),
  nickname: z.string().describe('Nickname (empty string if not set)'),
  nameTitle: z
    .string()
    .describe(
      'Name prefix/honorific (e.g., Dr., Mr.); empty string if not set',
    ),
  nameSuffix: z
    .string()
    .describe('Name suffix (e.g., Jr, III); empty string if not set'),
  companyName: z.string().describe('Company name from current position'),
  department: z
    .string()
    .describe('Department from current position (empty string if not set)'),
  jobTitle: z
    .string()
    .describe('Job title from current position (empty string if not set)'),
  officeLocation: z
    .string()
    .describe(
      'Office location from current position (empty string if not set)',
    ),
  emails: z
    .array(ContactEmailSchema)
    .describe('All email addresses for this contact'),
  phones: z
    .array(ContactPhoneSchema)
    .describe('All phone numbers for this contact'),
  addresses: z.array(ContactAddressSchema).describe('Postal addresses'),
  positions: z
    .array(ContactPositionSchema)
    .describe('Work history and positions'),
  websites: z
    .array(ContactWebsiteSchema)
    .describe('Personal and business websites'),
  relationships: z
    .array(ContactRelationshipSchema)
    .describe(
      'Related people (manager, assistant, spouse, children, colleagues)',
    ),
  birthday: z
    .string()
    .describe('Birthday in ISO 8601 date format (empty string if not set)'),
  anniversary: z
    .string()
    .describe(
      'Wedding anniversary in ISO 8601 date format (empty string if not set)',
    ),
  notes: z.string().describe('Personal notes (may be empty)'),
  photoUrl: z.string().describe('Profile photo URL (empty string if no photo)'),
  webAccounts: z
    .array(ContactWebAccountSchema)
    .optional()
    .describe(
      'IM/chat accounts (Skype, Teams, etc.). Only present when webAccounts is included in expand.',
    ),
  tags: z
    .array(ContactTagSchema)
    .optional()
    .describe(
      'Contact tags/categories from PeopleGraphVx. Only present when tags is included in expand.',
    ),
  createdDateTime: z
    .string()
    .optional()
    .describe(
      'ISO 8601 date when the contact was created. Always returned by the API.',
    ),
  lastModifiedDateTime: z
    .string()
    .optional()
    .describe(
      'ISO 8601 date when the contact was last modified. Always returned by the API.',
    ),
  isEditable: z
    .boolean()
    .optional()
    .describe(
      'Whether the contact can be modified by the current user. Always returned by the API.',
    ),
  parentFolderId: z
    .string()
    .optional()
    .describe(
      'ID of the contact folder containing this contact. From legacyContactMetadata.',
    ),
  pronunciationFirstName: z
    .string()
    .optional()
    .describe(
      'Phonetic pronunciation of the first name (yomigana / furigana). From name.pronunciation.first.',
    ),
  pronunciationLastName: z
    .string()
    .optional()
    .describe(
      'Phonetic pronunciation of the last name (yomigana / furigana). From name.pronunciation.last.',
    ),
  initials: z
    .string()
    .optional()
    .describe('Contact initials (e.g., "SXT"). From name.initials.'),
  companyPronunciation: z
    .string()
    .optional()
    .describe(
      'Phonetic pronunciation of the company name (yomigana / furigana). From positions[0].detail.company.pronunciation.',
    ),
  companyWebUrl: z
    .string()
    .optional()
    .describe('Company website URL. From positions[0].detail.company.webUrl.'),
  sensitivity: z
    .enum(['Normal', 'Personal', 'Private', 'Confidential'])
    .optional()
    .describe(
      'Sensitivity level of the contact. From legacyContactMetadata.sensitivity.',
    ),
  effectiveRights: z
    .string()
    .optional()
    .describe(
      'Comma-separated permission rights the current user has on this contact (e.g., "Modify, Read, Delete"). From legacyContactMetadata.effectiveRights.',
    ),
  itemClass: z
    .string()
    .optional()
    .describe(
      'MAPI item class identifier (e.g., "IPM.Contact"). From legacyContactMetadata.itemClass.',
    ),
  allowedAudiences: z
    .string()
    .optional()
    .describe(
      'Visibility scope of the contact (e.g., "Me", "Organization"). Top-level API field.',
    ),
  etag: z
    .string()
    .optional()
    .describe(
      'OData ETag for concurrency control. From @odata.etag response header. Can be used with If-Match headers for conditional updates.',
    ),
});

// ============================================================================
// Calendar Entities
// ============================================================================

export const ReminderItemSchema = z.object({
  subject: z.string().describe('Reminder subject'),
  itemId: z.string().describe('Item ID of the calendar event or task'),
  changeKey: z
    .string()
    .describe('Change key for concurrency control on the item'),
  uid: z
    .string()
    .describe('Globally unique calendar UID (iCalendar UID) for the event'),
  startDate: z.string().describe('ISO 8601 start date of the event'),
  endDate: z.string().describe('ISO 8601 end date of the event'),
  reminderTime: z
    .string()
    .describe('ISO 8601 date/time when the reminder fires'),
  location: z.string().describe('Event location, if set'),
  joinOnlineMeetingUrl: z
    .string()
    .describe('URL to join online meeting (empty string if none)'),
  reminderGroupType: z
    .number()
    .describe('Reminder group type bitmask (1 = Calendar event, 2 = Task)'),
  isOccurrence: z
    .boolean()
    .describe('Whether this is a recurring event occurrence'),
  isMeeting: z.boolean().describe('Whether this is a meeting (has attendees)'),
});

// ============================================================================
// Inferred Types
// ============================================================================

export type OutlookAuth = z.infer<typeof OutlookAuthSchema>;
export type EmailAddress = z.infer<typeof EmailAddressSchema>;
export type EmailSummary = z.infer<typeof EmailSummarySchema>;
export type EmailContent = z.infer<typeof EmailContentSchema>;
export type FolderSummary = z.infer<typeof FolderSummarySchema>;
export type ContactEmail = z.infer<typeof ContactEmailSchema>;
export type ContactPhone = z.infer<typeof ContactPhoneSchema>;
export type ContactAddress = z.infer<typeof ContactAddressSchema>;
export type ContactPosition = z.infer<typeof ContactPositionSchema>;
export type ContactWebsite = z.infer<typeof ContactWebsiteSchema>;
export type ContactRelationship = z.infer<typeof ContactRelationshipSchema>;
export type ContactWebAccount = z.infer<typeof ContactWebAccountSchema>;
export type ContactTag = z.infer<typeof ContactTagSchema>;
export type ContactSummary = z.infer<typeof ContactSummarySchema>;
export type ContactDetail = z.infer<typeof ContactDetailSchema>;
export type AttachmentMetadata = z.infer<typeof AttachmentMetadataSchema>;
export type ReminderItem = z.infer<typeof ReminderItemSchema>;
