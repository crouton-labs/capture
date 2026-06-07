// Re-export all sub-modules
export * from './shared';
export * from './auth';
export * from './email';
export * from './folders';
export * from './contacts';
export * from './calendar';
export * from './search';

// Import function schemas for allSchemas array
import { getContextSchema, switchAccountSchema } from './auth';
import {
  listEmailsSchema,
  getEmailSchema,
  sendEmailSchema,
  replyToEmailSchema,
  forwardEmailSchema,
  moveEmailSchema,
  deleteEmailSchema,
  markEmailReadSchema,
  flagEmailSchema,
  getConversationSchema,
  getAttachmentSchema,
} from './email';
import {
  listFoldersSchema,
  getFolderSchema,
  createFolderSchema,
  deleteFolderSchema,
  renameFolderSchema,
} from './folders';
import {
  listContactsSchema,
  getContactSchema,
  createContactSchema,
  updateContactSchema,
  deleteContactSchema,
} from './contacts';
import {
  getCalendarConfigSchema,
  getRemindersSchema,
  createEventSchema,
  listEventsSchema,
  getEventSchema,
  updateEventSchema,
  deleteEventSchema,
} from './calendar';
import {
  searchMailSchema,
  listCategoriesSchema,
  getSettingsSchema,
} from './search';

// ============================================================================
// Library Metadata
// ============================================================================

export const libraryDescription =
  'Outlook Web App: email, contacts, calendar, and mail settings';

export const libraryIcon = '/icons/libs/outlook.jpg';
export const loginUrl = 'https://outlook.live.com';

export const libraryNotes = `
## Workflow

1. Navigate to \`https://outlook.live.com/mail/0/\`, \`https://outlook.office.com/mail/\`, or \`https://outlook.cloud.microsoft/mail/\`
2. Call \`getContext()\`; if multiple accounts are signed in, check \`availableAccounts\` and re-call with the desired \`account\` email
3. If the desired account is not the active session (getContext throws a session-mismatch error), call \`switchAccount({ email })\` first, then re-call \`getContext()\`. **switchAccount navigates the page, which invalidates the current executor** — create a new executor after switching before calling getContext.
4. Pass the returned \`auth\` object to every subsequent function

## Auth

\`getContext()\` returns an \`auth\` object containing all required headers. Pass the entire \`auth\` object unchanged to every function; do not extract individual fields.

## Pagination

Email and folder listing use offset-based pagination: \`offset\` (starting position, default 0) and \`maxCount\` (page size, default 50). Contact listing uses cursor-based pagination: \`top\` (page size) + \`skipToken\` (cursor from previous response). Mail search uses \`from\`/\`size\`.

## Item IDs

Outlook uses ImmutableId format for all item references. IDs are long opaque strings. Always use exact IDs returned by list/get operations; never construct or guess them.

## Folders

Well-known folder names: inbox, drafts, sentitems, deleteditems, junkemail, archive, msgfolderroot. Custom folders require a folder ID discovered via folder listing.

## Contacts

Contact IDs are persona IDs that aggregate data from multiple linked sources (Exchange, LinkedIn, etc.). Navigate to the People page (outlook.live.com/people/0/) before listing contacts.

## Calendar

Events are created with automatic meeting invitation sending when attendees are provided. Check calendar settings for the user's configured timezone before creating events.
`;

// ============================================================================
// Rate Limits
// ============================================================================

export const rateLimits: Record<
  string,
  Array<{
    window: 'SECOND' | 'MINUTE' | 'HOUR' | 'DAY';
    maxCalls: number;
    message: string;
  }>
> = {
  sendEmail: [
    {
      window: 'MINUTE',
      maxCalls: 10,
      message: 'Outlook web throttles >10 sends/min',
    },
    {
      window: 'DAY',
      maxCalls: 500,
      message: 'M365 outbound cap ~500/day for non-EOP accounts',
    },
  ],
  replyToEmail: [
    { window: 'MINUTE', maxCalls: 10, message: 'Same throttle as sendEmail' },
  ],
  forwardEmail: [
    { window: 'MINUTE', maxCalls: 10, message: 'Same throttle as sendEmail' },
  ],
};

// ============================================================================
// All Schemas (33 total)
// ============================================================================

export const allSchemas = [
  // Auth (2)
  getContextSchema,
  switchAccountSchema,
  // Email (11)
  listEmailsSchema,
  getEmailSchema,
  sendEmailSchema,
  replyToEmailSchema,
  forwardEmailSchema,
  moveEmailSchema,
  deleteEmailSchema,
  markEmailReadSchema,
  flagEmailSchema,
  getConversationSchema,
  getAttachmentSchema,
  // Folders (5)
  listFoldersSchema,
  getFolderSchema,
  createFolderSchema,
  deleteFolderSchema,
  renameFolderSchema,
  // Contacts (5)
  listContactsSchema,
  getContactSchema,
  createContactSchema,
  updateContactSchema,
  deleteContactSchema,
  // Calendar (7)
  getCalendarConfigSchema,
  getRemindersSchema,
  createEventSchema,
  listEventsSchema,
  getEventSchema,
  updateEventSchema,
  deleteEventSchema,
  // Search/Utils (3)
  searchMailSchema,
  listCategoriesSchema,
  getSettingsSchema,
];
