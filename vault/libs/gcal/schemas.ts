import { z } from 'zod';

export const libraryDescription =
  'Google Calendar operations via internal APIs (JSPB protocol)';

export const libraryIcon = '/icons/libs/gcal.ico';
export const loginUrl = 'https://calendar.google.com';

export const libraryNotes = `
## BEFORE YOU DO ANYTHING

**ALWAYS confirm which Google account to use.** Users have multiple accounts (personal/work).
1. Call \`listAccounts()\` first
2. Ask the user: "Which Google account should I use?" and list the options
3. Only proceed after explicit confirmation. NEVER assume.

## Date/Time: Always Use Browser Local Time

**NEVER use \`new Date().toISOString()\` to derive dates.** ISO strings are UTC, which can be a different day than the user's local timezone (e.g., 9 PM PST is already the next day in UTC).

Always compute dates inside the \`executeJS\` block using the browser's local timezone:
\`\`\`js
const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in user's timezone
\`\`\`

## Workflow

**For READ operations** (listEvents, getEvent, searchEvents, showAvailability):
1. Navigate to \`https://calendar.google.com/calendar\`
2. Call \`listAccounts()\` and confirm which account
3. Call read functions directly - no context needed

**For WRITE operations** (createEvent, editEvent, deleteEvent, updateTime, updateLocation):
1. Navigate to \`https://calendar.google.com/calendar\`
2. Call \`listAccounts()\` and confirm which account
3. Call write function directly - context is auto-bootstrapped

## Resolving Attendee Emails

When the user names a person but doesn't provide their email (e.g., "book a meeting with Adam Banga"), **search Gmail for their email before asking the user.** Use the Gmail library's \`searchEmails\` with the person's name to find their email from past conversations. Only ask the user if Gmail search returns no results.

## After Creating/Modifying Events

Always include a direct link to the calendar day view so the user can see the event:
\`https://calendar.google.com/calendar/u/{account}/r/day/{YYYY}/{M}/{D}\`
where \`{account}\` is the account number (0, 1, etc.) and the date matches the event.

## Google Meet by Default

Always set \`meet: true\` when creating events unless the user specifies a physical location or explicitly says no video call. Most meetings are virtual; defaulting to Meet avoids an extra question.

## Destructive Operations

**CRITICAL**: Always confirm before create/edit/delete.
Show what will happen, get explicit user approval.

## Recurring Events

For custom weekly patterns (e.g., every Monday and Wednesday), use recurrence: 'weekly' with recurrenceDays: ['monday', 'wednesday'].
`;

// ============================================================================
// Shared Parameter Schemas
// ============================================================================

export const SyncTokenParam = z
  .string()
  .describe('Sync token from getContext (base64 encoded)');

export const AccountParam = z
  .number()
  .int()
  .min(0)
  .describe('Account number from URL /u/{N}/ (0-indexed)');

export const EventIdParam = z
  .string()
  .regex(/^[a-z0-9_]+$/i)
  .describe(
    'Event ID (26-char alphanumeric, optionally with _YYYYMMDDTHHMMSSZ instance suffix)',
  );

export const CalendarIdParam = z
  .string()
  .email()
  .describe('Calendar ID (typically the user email address)');

export const SecidParam = z
  .string()
  .optional()
  .describe('Security ID (secid) from page context');

// ============================================================================
// Shared Output Schemas
// ============================================================================

export const AccountSchema = z.object({
  email: z.string().describe('Email address'),
  name: z.string().describe('Display name'),
  accountNumber: z.number().describe('Account index (0-based)'),
  userId: z.string().describe('Google user ID'),
  isCurrent: z.boolean().describe('Whether this is the current account'),
});

export const AttendeeSchema = z.object({
  email: z.string().email().describe('Attendee email address'),
  responseStatus: z
    .enum(['needsAction', 'declined', 'tentative', 'accepted'])
    .describe('Response status'),
  organizer: z
    .boolean()
    .optional()
    .describe('Whether this attendee is the organizer'),
  self: z.boolean().optional().describe('Whether this attendee is you'),
});

export const EventSummarySchema = z.object({
  id: EventIdParam,
  title: z.string().describe('Event title'),
  location: z.string().optional().describe('Event location'),
  startMs: z.number().describe('Start time in milliseconds since epoch'),
  endMs: z.number().describe('End time in milliseconds since epoch'),
  startTime: z
    .string()
    .describe('Start time formatted as readable time (e.g., "5:00 PM")'),
  endTime: z
    .string()
    .describe('End time formatted as readable time (e.g., "6:00 PM")'),
  date: z
    .string()
    .describe('Date formatted as readable date (e.g., "2026-01-28")'),
  isAllDay: z.boolean().optional().describe('Whether this is an all-day event'),
});

export const EventDetailSchema = z.object({
  id: EventIdParam,
  title: z.string().describe('Event title'),
  description: z.string().nullable().describe('Event description'),
  location: z.string().nullable().describe('Event location'),
  startTime: z.string().nullable().describe('Start time ISO 8601 string'),
  endTime: z.string().nullable().describe('End time ISO 8601 string'),
  timezone: z
    .string()
    .nullable()
    .describe('Timezone identifier (e.g., "America/Los_Angeles")'),
  organizer: z
    .object({
      email: z.string().email(),
      self: z.boolean().describe('Whether organizer is you'),
    })
    .nullable()
    .describe('Event organizer'),
  attendees: z.array(AttendeeSchema).describe('Event attendees'),
  meetLink: z.string().nullable().describe('Google Meet link if present'),
  conferenceData: z
    .object({
      type: z.enum(['hangoutsMeet', 'other']),
      url: z.string(),
      meetingId: z.string(),
    })
    .nullable()
    .describe('Conference data'),
  recurrence: z
    .array(z.string())
    .nullable()
    .describe('Recurrence rules (RRULE format)'),
  created: z.string().nullable().describe('Creation timestamp ISO 8601'),
  updated: z.string().nullable().describe('Last update timestamp ISO 8601'),
});

export const ClientHeaderSchema = z
  .array(z.any())
  .describe('Client header array for sync.sync requests (captured from page)');

// ============================================================================
// Context Schema
// ============================================================================

export const GcalContextSchema = z.object({
  syncToken: z
    .string()
    .describe('Sync token for API requests (base64 encoded)'),
  clientHeader: ClientHeaderSchema.describe('Client header for sync.sync API'),
  secid: z.string().optional().describe('Security ID for API requests'),
  account: z.number().describe('Account number (0-indexed)'),
  email: z.string().describe('Email address of current account'),
  calendarId: z
    .string()
    .describe('Primary calendar ID (typically same as email)'),
});

// ============================================================================
// Action Schemas
// ============================================================================

export const bootstrapSyncContextSchema = {
  name: 'bootstrapSyncContext',
  description:
    'Bootstrap a sync context with valid token and secid for write operations',
  notes:
    'No network interception required. Works in browser JS context. Returns context with valid token and secid. ' +
    'User must be on calendar.google.com. ' +
    'This is the PREFERRED method for getting context for write operations (create/edit/delete events). ' +
    'USAGE: `const context = await bootstrapSyncContext({ account }); await createEvent({ ...context, title, date, start });` - spread the context into write functions.',
  input: z.object({
    account: AccountParam.optional(),
  }),
  output: GcalContextSchema,
};

export const listAccountsSchema = {
  name: 'listAccounts',
  description: 'List all Google accounts in the current browser session',
  notes:
    'CALL THIS FIRST before any Calendar operation. Users often have multiple accounts (personal/work). ' +
    'You MUST list accounts and ask the user which one to use before proceeding. Never assume.',
  input: z.object({}),
  output: z.object({
    accounts: z.array(AccountSchema),
    currentAccountNumber: z.number().describe('Currently active account index'),
    totalAccounts: z.number().describe('Total number of accounts'),
  }),
};

export const switchAccountSchema = {
  name: 'switchAccount',
  description: 'Navigate to a different Google account calendar',
  notes:
    'Changes the active calendar account by navigating to /u/{accountNumber}/. ' +
    'After switching, call bootstrapSyncContext() with the new account number for write operations.',
  input: z.object({
    accountNumber: AccountParam,
  }),
  output: z.object({
    success: z.boolean(),
    accountNumber: z.number(),
    url: z.string().describe('New calendar URL'),
  }),
};

export const listEventsSchema = {
  name: 'listEvents',
  description: 'List calendar events in a date range',
  notes:
    'Returns events from primary calendar in specified date range. ' +
    'Uses /minievents endpoint for fast event listing. ' +
    'Start/end times are in milliseconds since epoch.',
  input: z.object({
    account: AccountParam,
    calendarId: CalendarIdParam,
    startDate: z.string().describe('Start date YYYY-MM-DD (local timezone)'),
    endDate: z
      .string()
      .optional()
      .describe(
        'End date YYYY-MM-DD (optional, defaults to startDate + 7 days)',
      ),
    days: z
      .number()
      .optional()
      .default(7)
      .describe('Days from start if endDate not provided'),
  }),
  output: z.object({
    events: z.array(EventSummarySchema),
    calendar: CalendarIdParam,
    startDate: z.string().describe('Start date ISO 8601'),
    endDate: z.string().describe('End date ISO 8601'),
  }),
};

export const getEventSchema = {
  name: 'getEvent',
  description: 'Get full event details including attendees and conference data',
  notes:
    'Returns event metadata, attendees, organizer, Meet links, and recurrence rules. ' +
    'Pass the `date` field from the corresponding listEvents result as eventDate; ' +
    'works for past or future events regardless of how long ago.',
  input: z.object({
    account: AccountParam,
    eventId: EventIdParam,
    eventDate: z
      .string()
      .describe(
        'Date the event occurs (YYYY-MM-DD). Use the `date` field from listEvents output.',
      ),
  }),
  output: z.object({
    success: z.boolean(),
    event: EventDetailSchema,
    calendar: CalendarIdParam,
  }),
};

export const searchEventsSchema = {
  name: 'searchEvents',
  description:
    'Search calendar events by title (case-insensitive substring match)',
  notes:
    'Searches events in specified date range by title. ' +
    'Uses listEvents internally and filters by title. ' +
    'Returns summary data only - use getEvent() for full details.',
  input: z.object({
    account: AccountParam,
    calendarId: CalendarIdParam,
    query: z
      .string()
      .describe('Search query (matches event title, case-insensitive)'),
    startDate: z.string().describe('Start date YYYY-MM-DD'),
    endDate: z.string().optional().describe('End date YYYY-MM-DD (optional)'),
    days: z
      .number()
      .optional()
      .default(30)
      .describe('Days from start if endDate not provided'),
  }),
  output: z.object({
    events: z.array(EventSummarySchema),
    query: z.string(),
    matchCount: z.number().describe('Number of matching events'),
  }),
};

export const createEventSchema = {
  name: 'createEvent',
  description:
    'Create a new calendar event with optional attendees and Google Meet link',
  notes:
    '**DESTRUCTIVE**: Always confirm with user before creating. ' +
    'Context is auto-bootstrapped if not provided. ' +
    'For custom weekly patterns, use recurrence: "weekly" with recurrenceDays: ["monday", "wednesday"]. ' +
    'Meet links are created automatically if `meet: true` via ConferencingService API.',
  input: z.object({
    syncToken: SyncTokenParam.optional(),
    clientHeader: ClientHeaderSchema.optional(),
    secid: SecidParam,
    account: AccountParam.optional(),
    calendarId: CalendarIdParam.optional(),
    title: z.string().describe('Event title'),
    description: z.string().optional().describe('Event description'),
    location: z.string().optional().describe('Event location'),
    date: z.string().describe('Event date YYYY-MM-DD'),
    start: z.string().describe('Start time HH:MM (24-hour format)'),
    end: z
      .string()
      .optional()
      .describe('End time HH:MM (if omitted, calculated from duration)'),
    duration: z
      .number()
      .optional()
      .default(60)
      .describe('Duration in minutes (default: 60)'),
    attendees: z
      .array(z.string().email())
      .optional()
      .describe('Attendee email addresses (REQUIRED for recurring events)'),
    meet: z.boolean().optional().describe('Add Google Meet link'),
    recurrence: z
      .enum(['daily', 'weekly', 'monthly', 'yearly'])
      .optional()
      .describe('Recurrence type'),
    recurrenceDays: z
      .array(z.string())
      .optional()
      .describe(
        'Custom weekly days for recurrence (e.g., ["monday", "wednesday"]). Only used when recurrence is "weekly". Valid values: monday, tuesday, wednesday, thursday, friday, saturday, sunday.',
      ),
    timezone: z
      .string()
      .optional()
      .default('America/Los_Angeles')
      .describe('Timezone identifier'),
  }),
  output: z.object({
    success: z.boolean(),
    eventId: EventIdParam,
    meetUrl: z.string().nullable().describe('Google Meet URL if created'),
    newToken: z.boolean().describe('Whether sync token was updated'),
  }),
};

export const editEventSchema = {
  name: 'editEvent',
  description: 'Edit an existing event (delete + recreate)',
  notes:
    '**DESTRUCTIVE**: Always confirm with user before editing. ' +
    'Implemented by fetching event, deleting it, and creating new event with modifications. ' +
    'Event ID will change (new event created). ' +
    'Attendees receive new invitations. ' +
    'At least one field must be modified.',
  input: z.object({
    syncToken: SyncTokenParam.optional(),
    clientHeader: ClientHeaderSchema.optional(),
    secid: SecidParam,
    account: AccountParam.optional(),
    calendarId: CalendarIdParam.optional(),
    eventId: EventIdParam,
    eventDate: z
      .string()
      .describe(
        'Current date of the event being edited (YYYY-MM-DD). Use the `date` field from listEvents output.',
      ),
    title: z.string().optional().describe('New title'),
    description: z
      .string()
      .optional()
      .describe('New description (use "" to clear)'),
    location: z.string().optional().describe('New location (use "" to clear)'),
    date: z.string().optional().describe('New date YYYY-MM-DD'),
    start: z.string().optional().describe('New start time HH:MM'),
    end: z.string().optional().describe('New end time HH:MM'),
    duration: z.number().optional().describe('New duration in minutes'),
    attendees: z
      .array(z.string().email())
      .optional()
      .describe('Replace all attendees'),
    addAttendees: z
      .array(z.string().email())
      .optional()
      .describe('Add attendees'),
    removeAttendees: z
      .array(z.string().email())
      .optional()
      .describe('Remove attendees'),
    meet: z
      .boolean()
      .optional()
      .describe(
        'Add Meet link (true), remove Meet link (false), or keep (undefined)',
      ),
    recurrence: z
      .enum(['daily', 'weekly', 'monthly', 'yearly', 'none'])
      .optional()
      .describe('Change recurrence ("none" removes recurrence)'),
    recurrenceDays: z
      .array(z.string())
      .optional()
      .describe(
        'Custom weekly days (e.g., ["monday", "wednesday"]). Only used with recurrence: "weekly".',
      ),
  }),
  output: z.object({
    success: z.boolean(),
    originalEventId: EventIdParam,
    newEventId: EventIdParam,
    meetUrl: z.string().nullable(),
    changes: z
      .object({
        title: z.boolean(),
        description: z.boolean(),
        location: z.boolean(),
        date: z.boolean(),
        time: z.boolean(),
        attendees: z.boolean(),
        meet: z.boolean(),
        recurrence: z.boolean(),
      })
      .describe('Which fields were changed'),
    event: z.object({
      title: z.string(),
      date: z.string(),
      start: z.string(),
      end: z.string().nullable(),
      recurrence: z.string().nullable(),
      attendees: z.array(z.string().email()),
    }),
  }),
};

export const deleteEventSchema = {
  name: 'deleteEvent',
  description: 'Delete a calendar event',
  notes:
    '**DESTRUCTIVE**: Always confirm with user before deleting. ' +
    'Uses sync.sync API (operation type 14). ' +
    'Deleted events cannot be recovered. ' +
    'For recurring events, deletes all instances (scope parameter not yet implemented).',
  input: z.object({
    syncToken: SyncTokenParam.optional(),
    clientHeader: ClientHeaderSchema.optional(),
    secid: SecidParam,
    account: AccountParam.optional(),
    calendarId: CalendarIdParam.optional(),
    eventId: EventIdParam,
    eventDate: z
      .string()
      .describe(
        'Date of the event being deleted (YYYY-MM-DD). Use the `date` field from listEvents output.',
      ),
  }),
  output: z.object({
    success: z.boolean(),
    eventId: EventIdParam,
    newToken: z.boolean().describe('Whether sync token was updated'),
  }),
};

export const updateTimeSchema = {
  name: 'updateTime',
  description: 'Update event start and end time',
  notes:
    '**DESTRUCTIVE**: Always confirm with user before updating. ' +
    'Uses sync.sync operation type 9 for time-only updates. ' +
    'Faster than editEvent for time changes only. ' +
    'Times must be in milliseconds since epoch.',
  input: z.object({
    syncToken: SyncTokenParam.optional(),
    clientHeader: ClientHeaderSchema.optional(),
    secid: SecidParam,
    account: AccountParam.optional(),
    calendarId: CalendarIdParam.optional(),
    eventId: EventIdParam,
    eventDate: z
      .string()
      .describe(
        'Current date of the event being moved (YYYY-MM-DD). Use the `date` field from listEvents output.',
      ),
    startMs: z.number().describe('New start time (milliseconds since epoch)'),
    endMs: z.number().describe('New end time (milliseconds since epoch)'),
  }),
  output: z.object({
    success: z.boolean(),
    eventId: EventIdParam,
    newToken: z.boolean(),
  }),
};

export const showAvailabilitySchema = {
  name: 'showAvailability',
  description: 'Show free/busy time slots for scheduling',
  notes:
    'Returns calendar availability for specified date range. ' +
    'Shows which time slots are free vs busy. ' +
    'Useful for finding meeting times. ' +
    'All times and dates are human-readable strings formatted using the browser locale.',
  input: z.object({
    account: AccountParam,
    calendarId: CalendarIdParam,
    startDate: z.string().describe('Start date YYYY-MM-DD'),
    endDate: z
      .string()
      .optional()
      .describe('End date YYYY-MM-DD (defaults to startDate)'),
  }),
  output: z.object({
    calendar: CalendarIdParam,
    startDate: z.string(),
    endDate: z.string(),
    busySlots: z.array(
      z.object({
        start: z
          .string()
          .describe('Start time formatted as readable time (e.g., "10:00 AM")'),
        end: z
          .string()
          .describe('End time formatted as readable time (e.g., "6:30 PM")'),
        date: z
          .string()
          .describe(
            'Date formatted as readable date (e.g., "January 28, 2026")',
          ),
        title: z.string().describe('Event title'),
        eventId: EventIdParam.describe('Event ID for reference'),
      }),
    ),
    freeSlots: z.array(
      z.object({
        start: z
          .string()
          .describe('Start time formatted as readable time (e.g., "10:00 AM")'),
        end: z
          .string()
          .describe('End time formatted as readable time (e.g., "6:30 PM")'),
        date: z
          .string()
          .describe(
            'Date formatted as readable date (e.g., "January 28, 2026")',
          ),
      }),
    ),
  }),
};

export const findOverlappingEventsSchema = {
  name: 'findOverlappingEvents',
  description: 'Find and group calendar events that overlap in time',
  notes:
    'Identifies events with overlapping time ranges. ' +
    'Useful for detecting duplicate events or scheduling conflicts. ' +
    'Returns groups of events that overlap, with each group showing the shared time range and count.',
  input: z.object({
    account: AccountParam,
    calendarId: CalendarIdParam,
    date: z.string().optional().describe('Date YYYY-MM-DD (defaults to today)'),
  }),
  output: z.object({
    overlappingGroups: z.array(
      z.object({
        timeRange: z
          .string()
          .describe('Time range of overlap (e.g., "5:00 PM - 6:00 PM")'),
        count: z.number().describe('Number of overlapping events'),
        events: z.array(
          z.object({
            id: EventIdParam,
            title: z.string().describe('Event title'),
            startTime: z.string().describe('Start time (e.g., "5:00 PM")'),
            endTime: z.string().describe('End time (e.g., "6:00 PM")'),
          }),
        ),
      }),
    ),
    totalOverlaps: z
      .number()
      .describe('Total number of overlapping events found'),
    date: z.string().describe('Date that was checked'),
  }),
};

// ============================================================================
// All Schemas Export
// ============================================================================

export const allSchemas = [
  bootstrapSyncContextSchema,
  listAccountsSchema,
  switchAccountSchema,
  listEventsSchema,
  getEventSchema,
  searchEventsSchema,
  findOverlappingEventsSchema,
  createEventSchema,
  editEventSchema,
  deleteEventSchema,
  updateTimeSchema,
  showAvailabilitySchema,
];

// ============================================================================
// Inferred Types
// ============================================================================

// Shared types
export type Account = z.infer<typeof AccountSchema>;
export type Attendee = z.infer<typeof AttendeeSchema>;
export type EventSummary = z.infer<typeof EventSummarySchema>;
export type EventDetail = z.infer<typeof EventDetailSchema>;
export type GcalContext = z.infer<typeof GcalContextSchema>;
export type ClientHeader = z.infer<typeof ClientHeaderSchema>;

// Input types
export type BootstrapSyncContextInput = z.infer<
  typeof bootstrapSyncContextSchema.input
>;
export type ListAccountsInput = z.infer<typeof listAccountsSchema.input>;
export type SwitchAccountInput = z.infer<typeof switchAccountSchema.input>;
export type ListEventsInput = z.infer<typeof listEventsSchema.input>;
export type GetEventInput = z.infer<typeof getEventSchema.input>;
export type SearchEventsInput = z.infer<typeof searchEventsSchema.input>;
export type FindOverlappingEventsInput = z.infer<
  typeof findOverlappingEventsSchema.input
>;
export type CreateEventInput = z.infer<typeof createEventSchema.input>;
export type EditEventInput = z.infer<typeof editEventSchema.input>;
export type DeleteEventInput = z.infer<typeof deleteEventSchema.input>;
export type UpdateTimeInput = z.infer<typeof updateTimeSchema.input>;
export type ShowAvailabilityInput = z.infer<
  typeof showAvailabilitySchema.input
>;

// Output types
export type BootstrapSyncContextOutput = z.infer<
  typeof bootstrapSyncContextSchema.output
>;
export type ListAccountsOutput = z.infer<typeof listAccountsSchema.output>;
export type SwitchAccountOutput = z.infer<typeof switchAccountSchema.output>;
export type ListEventsOutput = z.infer<typeof listEventsSchema.output>;
export type GetEventOutput = z.infer<typeof getEventSchema.output>;
export type SearchEventsOutput = z.infer<typeof searchEventsSchema.output>;
export type FindOverlappingEventsOutput = z.infer<
  typeof findOverlappingEventsSchema.output
>;
export type CreateEventOutput = z.infer<typeof createEventSchema.output>;
export type EditEventOutput = z.infer<typeof editEventSchema.output>;
export type DeleteEventOutput = z.infer<typeof deleteEventSchema.output>;
export type UpdateTimeOutput = z.infer<typeof updateTimeSchema.output>;
export type ShowAvailabilityOutput = z.infer<
  typeof showAvailabilitySchema.output
>;
