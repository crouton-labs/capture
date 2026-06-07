/**
 * Outlook Web App Library
 *
 * Browser-executable Outlook operations via internal EWS-over-JSON APIs.
 * Requires user to be logged into Outlook at outlook.live.com.
 */

// Auth
export { getContext, switchAccount } from './auth';

// Email operations
export {
  listEmails,
  getConversation,
  getEmail,
  sendEmail,
  replyToEmail,
  forwardEmail,
  moveEmail,
  deleteEmail,
  markEmailRead,
  flagEmail,
  getAttachment,
} from './email';

// Folder operations
export {
  listFolders,
  getFolder,
  createFolder,
  deleteFolder,
  renameFolder,
} from './folders';

// Contact operations
export {
  listContacts,
  getContact,
  createContact,
  updateContact,
  deleteContact,
} from './contacts';

// Calendar operations
export {
  getCalendarConfig,
  getReminders,
  createEvent,
  listEvents,
  getEvent,
  updateEvent,
  deleteEvent,
} from './calendar';

// Search, categories & settings
export { searchMail, listCategories, getSettings } from './search';

// Re-export all types from schemas
export type {
  OutlookAuth,
  EmailAddress,
  EmailSummary,
  EmailContent,
  GetContextInput,
  GetContextOutput,
  SwitchAccountInput,
  SwitchAccountOutput,
  ListEmailsInput,
  ListEmailsOutput,
  GetEmailInput,
  GetEmailOutput,
  SendEmailInput,
  SendEmailOutput,
  ReplyToEmailInput,
  ReplyToEmailOutput,
  ForwardEmailInput,
  ForwardEmailOutput,
  MoveEmailInput,
  MoveEmailOutput,
  DeleteEmailInput,
  DeleteEmailOutput,
  MarkEmailReadInput,
  MarkEmailReadOutput,
  FlagEmailInput,
  FlagEmailOutput,
  GetConversationInput,
  GetConversationOutput,
  AttachmentMetadata,
  GetAttachmentInput,
  GetAttachmentOutput,
  FolderSummary,
  ListFoldersInput,
  ListFoldersOutput,
  GetFolderInput,
  GetFolderOutput,
  CreateFolderInput,
  CreateFolderOutput,
  DeleteFolderInput,
  DeleteFolderOutput,
  RenameFolderInput,
  RenameFolderOutput,
  ContactEmail,
  ContactPhone,
  ContactAddress,
  ContactPosition,
  ContactSummary,
  ContactDetail,
  ListContactsInput,
  ListContactsOutput,
  GetContactInput,
  GetContactOutput,
  CreateContactInput,
  CreateContactOutput,
  UpdateContactInput,
  UpdateContactOutput,
  DeleteContactInput,
  DeleteContactOutput,
  GetCalendarConfigInput,
  GetCalendarConfigOutput,
  ReminderItem,
  GetRemindersInput,
  GetRemindersOutput,
  CreateEventInput,
  CreateEventOutput,
  AttendeeInfo,
  EventSummary,
  EventDetail,
  ListEventsInput,
  ListEventsOutput,
  GetEventInput,
  GetEventOutput,
  UpdateEventInput,
  UpdateEventOutput,
  DeleteEventInput,
  DeleteEventOutput,
  SearchMailInput,
  SearchMailOutput,
  ListCategoriesInput,
  ListCategoriesOutput,
  GetSettingsInput,
  GetSettingsOutput,
} from './schemas';
