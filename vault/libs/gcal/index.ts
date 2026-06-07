/**
 * Google Calendar Library
 *
 * Browser-executable Google Calendar operations via internal APIs (JSPB protocol).
 * Requires user to be logged into Google Calendar at calendar.google.com.
 *
 * CRITICAL: This code runs in the browser via CDP Runtime.evaluate.
 * - No Node.js modules (fs, WebSocket, etc.)
 * - Use browser globals: fetch, window, document
 * - All functions execute in browser context
 */

// Types from schemas
export type {
  Account,
  Attendee,
  EventSummary,
  EventDetail,
  GcalContext,
  ClientHeader,
  BootstrapSyncContextInput,
  BootstrapSyncContextOutput,
  ListAccountsInput,
  ListAccountsOutput,
  SwitchAccountInput,
  SwitchAccountOutput,
  ListEventsInput,
  ListEventsOutput,
  GetEventInput,
  GetEventOutput,
  SearchEventsInput,
  SearchEventsOutput,
  FindOverlappingEventsInput,
  FindOverlappingEventsOutput,
  CreateEventInput,
  CreateEventOutput,
  EditEventInput,
  EditEventOutput,
  DeleteEventInput,
  DeleteEventOutput,
  UpdateTimeInput,
  UpdateTimeOutput,
  ShowAvailabilityInput,
  ShowAvailabilityOutput,
} from './schemas';

// Context operations
export { bootstrapSyncContext, listAccounts, switchAccount } from './context';

// Event operations
export {
  listEvents,
  getEvent,
  searchEvents,
  showAvailability,
  findOverlappingEvents,
  createEvent,
  editEvent,
  deleteEvent,
  updateTime,
} from './events';
