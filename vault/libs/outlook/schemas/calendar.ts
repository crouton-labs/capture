import { z } from 'zod';
import { AuthParam, ReminderItemSchema, EmailAddressSchema } from './shared';

// ============================================================================
// getCalendarConfig
// ============================================================================

export const WeatherLocationSchema = z.object({
  name: z.string().describe('Location display name (e.g., "Redmond, WA")'),
  longitude: z.string().describe('Longitude coordinate'),
  latitude: z.string().describe('Latitude coordinate'),
  locationId: z.string().describe('Weather service location ID'),
});

export const getCalendarConfigSchema = {
  name: 'getCalendarConfig',
  description:
    'Get calendar-specific mailbox settings: timezone, working hours, default meeting duration, reminder settings, online meeting provider, weather, agenda email, and events-from-email preferences',
  notes: '',
  input: z.object({
    auth: AuthParam,
  }),
  output: z.object({
    timezone: z
      .string()
      .describe(
        'Windows timezone ID for the calendar (e.g., "Pacific Standard Time")',
      ),
    workingHours: z
      .object({
        timeZone: z.string().describe('Windows timezone ID for working hours'),
        workDays: z
          .array(z.string())
          .describe(
            'Working days (e.g., ["Monday","Tuesday","Wednesday","Thursday","Friday"])',
          ),
        startTime: z
          .string()
          .describe('Working hours start time (HH:MM:SS format)'),
        endTime: z
          .string()
          .describe('Working hours end time (HH:MM:SS format)'),
      })
      .optional()
      .describe('Working hours configuration'),
    defaultReminderMinutes: z
      .number()
      .describe('Default reminder time in minutes before meetings'),
    defaultOnlineMeetingProvider: z
      .string()
      .optional()
      .describe(
        'Default online meeting provider (e.g., TeamsForLife, TeamsForBusiness, SkypeForBusiness, Unknown)',
      ),
    defaultMeetingDuration: z
      .number()
      .optional()
      .describe('Default meeting duration in minutes (e.g., 30, 60)'),
    weekStartDay: z
      .number()
      .optional()
      .describe(
        'First day of the week as a number (0=Sunday, 1=Monday, ... 6=Saturday)',
      ),
    timeIncrement: z
      .number()
      .optional()
      .describe('Calendar time scale increment in minutes (e.g., 6, 15, 30)'),
    showWeekNumbers: z
      .boolean()
      .optional()
      .describe('Whether week numbers are displayed in the calendar'),
    firstWeekOfYear: z
      .number()
      .optional()
      .describe(
        'Rule for determining the first week of the year (0=Jan1, 1=FirstDayOfYear, 2=FirstFullWeek, 3=FirstFourDayWeek)',
      ),
    remindersEnabled: z
      .boolean()
      .optional()
      .describe('Whether calendar reminders are enabled'),
    reminderSoundEnabled: z
      .boolean()
      .optional()
      .describe('Whether reminder sounds are enabled'),
    addOnlineMeetingToAllEvents: z
      .boolean()
      .optional()
      .describe(
        'Whether online meeting links are automatically added to all new events',
      ),
    allowedOnlineMeetingProviders: z
      .array(z.string())
      .optional()
      .describe(
        'List of available online meeting providers (e.g., TeamsForLife, Zoom, GoogleMeet, Webex)',
      ),
    weatherEnabled: z
      .number()
      .optional()
      .describe(
        'Whether weather is shown in the calendar (0=disabled, 1=enabled)',
      ),
    weatherUnit: z
      .number()
      .optional()
      .describe('Weather temperature unit (0=Fahrenheit, 1=Celsius)'),
    weatherLocations: z
      .array(WeatherLocationSchema)
      .optional()
      .describe('Configured weather locations'),
    agendaMailEnabled: z
      .boolean()
      .optional()
      .describe('Whether daily agenda email is enabled'),
    skipAgendaMailOnFreeDays: z
      .boolean()
      .optional()
      .describe('Whether to skip sending agenda email on days with no events'),
    eventsFromEmailEnabled: z
      .boolean()
      .optional()
      .describe(
        'Whether automatic event creation from email content is enabled',
      ),
    createEventsFromEmailAsPrivate: z
      .boolean()
      .optional()
      .describe('Whether events created from email are marked as private'),
    autoDeclineWhenBusy: z
      .boolean()
      .optional()
      .describe(
        'Whether to automatically decline new meeting requests that conflict with existing events',
      ),
    preserveDeclinedMeetings: z
      .boolean()
      .optional()
      .describe('Whether declined meetings are kept on the calendar'),
    deleteMeetingRequestOnRespond: z
      .boolean()
      .optional()
      .describe('Whether meeting request emails are deleted after responding'),
  }),
};

// ============================================================================
// getReminders
// ============================================================================

export const getRemindersSchema = {
  name: 'getReminders',
  description:
    'Retrieve upcoming calendar event and task reminders within a time window',
  notes: '',
  input: z.object({
    auth: AuthParam,
    beginTime: z
      .string()
      .describe(
        'ISO 8601 start of the time window (e.g., "2024-01-15T00:00:00")',
      ),
    endTime: z
      .string()
      .describe(
        'ISO 8601 end of the time window (e.g., "2024-01-22T23:59:59")',
      ),
    reminderType: z
      .enum(['All', 'Current', 'Old'])
      .optional()
      .default('All')
      .describe(
        'Filter reminder type: All = reminders in window, Current = All plus ongoing events and all appointments regardless of age, Old = All minus incomplete events and all appointments',
      ),
    maxItems: z
      .number()
      .optional()
      .describe(
        'Maximum number of reminders to return (0-200). Omit for server default.',
      ),
  }),
  output: z.object({
    reminders: z
      .array(ReminderItemSchema)
      .describe('List of upcoming reminders'),
  }),
};

// ============================================================================
// Recurrence Schemas
// ============================================================================

const DailyRecurrenceSchema = z.object({
  type: z.literal('daily').describe('Daily recurrence pattern'),
  interval: z
    .number()
    .int()
    .min(1)
    .describe('Repeat every N days (e.g., 1 = every day, 2 = every other day)'),
});

const WeeklyRecurrenceSchema = z.object({
  type: z.literal('weekly').describe('Weekly recurrence pattern'),
  interval: z
    .number()
    .int()
    .min(1)
    .describe(
      'Repeat every N weeks (e.g., 1 = every week, 2 = every other week)',
    ),
  daysOfWeek: z
    .array(
      z.enum([
        'Sunday',
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday',
      ]),
    )
    .min(1)
    .describe(
      'Days of the week on which the event recurs (e.g., ["Monday", "Wednesday", "Friday"])',
    ),
});

const AbsoluteMonthlyRecurrenceSchema = z.object({
  type: z
    .literal('absoluteMonthly')
    .describe('Monthly recurrence on a specific day of the month'),
  interval: z.number().int().min(1).describe('Repeat every N months'),
  dayOfMonth: z
    .number()
    .int()
    .min(1)
    .max(31)
    .describe('Day of the month (1-31)'),
});

const RelativeMonthlyRecurrenceSchema = z.object({
  type: z
    .literal('relativeMonthly')
    .describe(
      'Monthly recurrence on a relative day (e.g., second Tuesday of every month)',
    ),
  interval: z.number().int().min(1).describe('Repeat every N months'),
  daysOfWeek: z
    .enum([
      'Sunday',
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Day',
      'Weekday',
      'WeekendDay',
    ])
    .describe('Day of the week'),
  weekIndex: z
    .enum(['First', 'Second', 'Third', 'Fourth', 'Last'])
    .describe('Which week of the month (e.g., "First", "Last")'),
});

const AbsoluteYearlyRecurrenceSchema = z.object({
  type: z
    .literal('absoluteYearly')
    .describe('Yearly recurrence on a specific date (e.g., March 15)'),
  dayOfMonth: z
    .number()
    .int()
    .min(1)
    .max(31)
    .describe('Day of the month (1-31)'),
  month: z
    .enum([
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ])
    .describe('Month of the year'),
});

const RelativeYearlyRecurrenceSchema = z.object({
  type: z
    .literal('relativeYearly')
    .describe(
      'Yearly recurrence on a relative day (e.g., third Monday of November)',
    ),
  daysOfWeek: z
    .enum([
      'Sunday',
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Day',
      'Weekday',
      'WeekendDay',
    ])
    .describe('Day of the week'),
  weekIndex: z
    .enum(['First', 'Second', 'Third', 'Fourth', 'Last'])
    .describe('Which week of the month'),
  month: z
    .enum([
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ])
    .describe('Month of the year'),
});

export const RecurrencePatternSchema = z
  .discriminatedUnion('type', [
    DailyRecurrenceSchema,
    WeeklyRecurrenceSchema,
    AbsoluteMonthlyRecurrenceSchema,
    RelativeMonthlyRecurrenceSchema,
    AbsoluteYearlyRecurrenceSchema,
    RelativeYearlyRecurrenceSchema,
  ])
  .describe('Recurrence pattern: how often the event repeats');

export const RecurrenceRangeSchema = z
  .object({
    startDate: z
      .string()
      .describe(
        'Recurrence start date in YYYY-MM-DD format (e.g., "2026-02-20"). Usually same as event start date.',
      ),
    endDate: z
      .string()
      .optional()
      .describe(
        'Recurrence end date in YYYY-MM-DD format (e.g., "2026-12-31"). If omitted, set numberOfOccurrences or the event recurs indefinitely.',
      ),
    numberOfOccurrences: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        'Total number of occurrences before the recurrence ends. Use instead of endDate for count-based recurrence.',
      ),
  })
  .describe('Recurrence range: when the recurrence starts and stops');

export const RecurrenceSchema = z
  .object({
    pattern: RecurrencePatternSchema,
    range: RecurrenceRangeSchema,
  })
  .describe(
    'Makes the event recurring. Combines a recurrence pattern (daily, weekly, monthly, yearly) with a range (end date, occurrence count, or no end).',
  );

// ============================================================================
// createEvent
// ============================================================================

export const createEventSchema = {
  name: 'createEvent',
  description:
    'Create a new calendar event and optionally send meeting invitations to attendees',
  notes:
    'Pass attendees as plain email address strings; they are converted to Outlook Mailbox objects internally. Meeting invitations are sent automatically when requiredAttendees or optionalAttendees are provided.',
  input: z.object({
    auth: AuthParam,
    subject: z.string().describe('Event subject/title'),
    start: z
      .string()
      .describe(
        'Event start time in ISO 8601 format (e.g., "2024-01-15T10:00:00")',
      ),
    end: z
      .string()
      .describe(
        'Event end time in ISO 8601 format (e.g., "2024-01-15T11:00:00")',
      ),
    location: z
      .string()
      .optional()
      .describe('Event location (room name, address, or URL)'),
    body: z
      .string()
      .optional()
      .describe('Event description/agenda (HTML supported)'),
    requiredAttendees: z
      .array(z.string().email())
      .optional()
      .describe('Email addresses of required attendees'),
    optionalAttendees: z
      .array(z.string().email())
      .optional()
      .describe('Email addresses of optional attendees'),
    reminderMinutes: z
      .number()
      .optional()
      .default(15)
      .describe('Minutes before event to show reminder (default: 15)'),
    isAllDay: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'If true, creates an all-day event (start/end should be date-only strings)',
      ),
    showAs: z
      .enum(['Free', 'Tentative', 'Busy', 'OOF', 'WorkingElsewhere', 'NoData'])
      .optional()
      .describe(
        'Free/busy status shown on the calendar. OOF = Out of Office, WorkingElsewhere = Working Elsewhere. Default is Busy.',
      ),
    sensitivity: z
      .enum(['Normal', 'Personal', 'Private', 'Confidential'])
      .optional()
      .describe(
        'Event sensitivity/privacy level. Private hides details from non-organizer attendees.',
      ),
    categories: z
      .array(z.string())
      .optional()
      .describe(
        'Category labels to apply (e.g., ["Blue category", "Green category"]). Uses the user\'s configured category names.',
      ),
    importance: z
      .enum(['Low', 'Normal', 'High'])
      .optional()
      .describe('Event importance/priority level'),
    isOnlineMeeting: z
      .boolean()
      .optional()
      .describe(
        'If true, adds an online meeting link using the default provider (TeamsForLife). To use a specific provider, set onlineMeetingProvider instead.',
      ),
    isResponseRequested: z
      .boolean()
      .optional()
      .describe(
        'If true (default), attendees are asked to respond with Accept/Tentative/Decline',
      ),
    allowNewTimeProposal: z
      .boolean()
      .optional()
      .describe('If true (default), attendees can propose a new meeting time'),
    charm: z
      .enum([
        'None',
        'Heart',
        'Car',
        'Cat',
        'Dog',
        'Music',
        'Travel',
        'Trophy',
        'Plane',
        'Soccer',
        'Star',
      ])
      .optional()
      .describe('Event icon charm displayed on the calendar'),
    doNotForwardMeeting: z
      .boolean()
      .optional()
      .describe(
        'If true, prevents attendees from forwarding the meeting invitation to others',
      ),
    hideAttendees: z
      .boolean()
      .optional()
      .describe(
        'If true, hides the attendee list so attendees only see themselves',
      ),
    onlineMeetingProvider: z
      .enum([
        'Unknown',
        'SkypeForBusiness',
        'SkypeForConsumer',
        'TeamsForBusiness',
      ])
      .optional()
      .describe(
        'Online meeting provider to use. Only applies when isOnlineMeeting is true.',
      ),
    startTimeZone: z
      .string()
      .optional()
      .describe(
        'Windows timezone ID for the event start time (e.g., "Eastern Standard Time", "UTC"). Overrides the mailbox default timezone for the start.',
      ),
    endTimeZone: z
      .string()
      .optional()
      .describe(
        'Windows timezone ID for the event end time (e.g., "Eastern Standard Time", "UTC"). Overrides the mailbox default timezone for the end.',
      ),
    isInPersonEvent: z
      .boolean()
      .optional()
      .describe(
        'If true, marks the event as an in-person event requiring physical attendance',
      ),
    recurrence: RecurrenceSchema.optional().describe(
      'Makes the event recurring. Specify a pattern (daily, weekly, monthly, yearly) and a range (end date, occurrence count, or no end). Example: weekly on Mon/Wed/Fri for 10 occurrences.',
    ),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the event was created successfully'),
    itemId: z.string().describe('ID of the created calendar event'),
  }),
};

// ============================================================================
// Calendar Entity Schemas
// ============================================================================

export const AttendeeInfoSchema = z.object({
  name: z.string().describe('Display name'),
  email: z.string().describe('Email address'),
  response: z
    .string()
    .describe(
      'Response status (Accept, Decline, Tentative, Unknown, NoResponseReceived)',
    ),
});

export const EventSummarySchema = z.object({
  itemId: z.string().describe('Immutable item ID'),
  subject: z.string().describe('Event subject/title'),
  start: z.string().describe('ISO 8601 start date/time'),
  end: z.string().describe('ISO 8601 end date/time'),
  location: z.string().describe('Event location'),
  organizer: EmailAddressSchema.describe('Event organizer'),
  requiredAttendees: z.array(AttendeeInfoSchema).describe('Required attendees'),
  optionalAttendees: z.array(AttendeeInfoSchema).describe('Optional attendees'),
  isAllDay: z.boolean().describe('Whether this is an all-day event'),
  isCancelled: z.boolean().describe('Whether the event has been cancelled'),
  isRecurring: z.boolean().describe('Whether this is a recurring event'),
  sensitivity: z
    .enum(['Normal', 'Personal', 'Private', 'Confidential'])
    .optional()
    .describe('Event sensitivity/privacy level'),
  isMeeting: z
    .boolean()
    .optional()
    .describe('Whether the event is a meeting with attendees'),
  calendarItemType: z
    .enum(['Single', 'Occurrence', 'Exception', 'RecurringMaster'])
    .optional()
    .describe(
      'Calendar item type: Single, Occurrence (instance of recurring), Exception (modified instance), RecurringMaster',
    ),
  categories: z
    .array(z.string())
    .optional()
    .describe('Category labels applied to the event'),
  hasAttachments: z
    .boolean()
    .optional()
    .describe('Whether the event has file attachments'),
  importance: z
    .enum(['Low', 'Normal', 'High'])
    .optional()
    .describe('Event importance/priority level'),
  responseType: z
    .enum([
      'Unknown',
      'Organizer',
      'Tentative',
      'Accept',
      'Decline',
      'NoResponseReceived',
    ])
    .optional()
    .describe("Current user's response status to the meeting"),
  preview: z
    .string()
    .optional()
    .describe('Short preview/snippet of the event body text'),
  reminderMinutesBeforeStart: z
    .number()
    .optional()
    .describe('Minutes before event when reminder fires'),
  isOrganizer: z
    .boolean()
    .optional()
    .describe('Whether the current user is the organizer'),
  startTimeZoneId: z
    .string()
    .optional()
    .describe(
      'Windows timezone ID for the event start time (e.g., "Pacific Standard Time")',
    ),
  endTimeZoneId: z
    .string()
    .optional()
    .describe(
      'Windows timezone ID for the event end time (e.g., "Pacific Standard Time")',
    ),
  freeBusyType: z
    .enum(['Free', 'Tentative', 'Busy', 'OOF', 'WorkingElsewhere', 'NoData'])
    .optional()
    .describe(
      'Show-as status: Free, Tentative, Busy, OOF (Out of Office), WorkingElsewhere, NoData',
    ),
  charm: z
    .enum([
      'None',
      'Heart',
      'Car',
      'Cat',
      'Dog',
      'Music',
      'Travel',
      'Trophy',
      'Plane',
      'Soccer',
      'Star',
    ])
    .optional()
    .describe('Event icon charm displayed on the calendar'),
});

export const EventDetailSchema = z.object({
  itemId: z.string().describe('Immutable item ID'),
  subject: z.string().describe('Event subject/title'),
  body: z.string().describe('Event body as HTML'),
  bodyText: z.string().describe('Event body as plain text'),
  start: z.string().describe('ISO 8601 start date/time'),
  end: z.string().describe('ISO 8601 end date/time'),
  location: z.string().describe('Event location'),
  organizer: EmailAddressSchema.describe('Event organizer'),
  requiredAttendees: z.array(AttendeeInfoSchema).describe('Required attendees'),
  optionalAttendees: z.array(AttendeeInfoSchema).describe('Optional attendees'),
  isAllDay: z.boolean().describe('Whether this is an all-day event'),
  isRecurring: z.boolean().describe('Whether this is a recurring event'),
  isCancelled: z.boolean().describe('Whether the event has been cancelled'),
  recurrence: z
    .string()
    .nullable()
    .describe('Recurrence pattern description (null if not recurring)'),
  reminderMinutes: z
    .number()
    .describe('Minutes before event when reminder fires'),
  categories: z.array(z.string()).describe('Category labels'),
  sensitivity: z
    .enum(['Normal', 'Personal', 'Private', 'Confidential'])
    .describe('Event sensitivity/privacy level'),
  importance: z
    .enum(['Low', 'Normal', 'High'])
    .describe('Event importance/priority level'),
  freeBusyType: z
    .enum(['Free', 'Tentative', 'Busy', 'OOF', 'WorkingElsewhere', 'NoData'])
    .describe(
      'Show-as status: Free, Tentative, Busy, OOF (Out of Office), WorkingElsewhere, NoData',
    ),
  hasAttachments: z
    .boolean()
    .describe('Whether the event has file attachments'),
  isOnlineMeeting: z
    .boolean()
    .describe('Whether the event is an online meeting (e.g., Teams)'),
  isMeeting: z
    .boolean()
    .describe('Whether the event is a meeting with attendees'),
  isOrganizer: z
    .boolean()
    .describe('Whether the current user is the organizer'),
  calendarItemType: z
    .enum(['Single', 'Occurrence', 'Exception', 'RecurringMaster'])
    .describe(
      'Calendar item type: Single, Occurrence (instance of recurring), Exception (modified instance), RecurringMaster',
    ),
  responseType: z
    .enum([
      'Unknown',
      'Organizer',
      'Tentative',
      'Accept',
      'Decline',
      'NoResponseReceived',
    ])
    .describe("Current user's response status to the meeting"),
  duration: z
    .string()
    .describe(
      'Event duration in ISO 8601 duration format (e.g., "PT30M", "PT1H")',
    ),
  uid: z
    .string()
    .describe('Globally unique calendar event identifier (iCalendar UID)'),
  dateTimeCreated: z
    .string()
    .describe('ISO 8601 date/time when the event was created'),
  startTimeZoneId: z
    .string()
    .describe(
      'Windows timezone ID for the event start time (e.g., "Pacific Standard Time")',
    ),
  endTimeZoneId: z
    .string()
    .describe(
      'Windows timezone ID for the event end time (e.g., "Pacific Standard Time")',
    ),
  onlineMeetingJoinUrl: z
    .string()
    .describe(
      'URL to join the online meeting (empty if not an online meeting)',
    ),
  charm: z
    .enum([
      'None',
      'Heart',
      'Car',
      'Cat',
      'Dog',
      'Music',
      'Travel',
      'Trophy',
      'Plane',
      'Soccer',
      'Star',
    ])
    .describe('Event icon charm displayed on the calendar'),
});

// ============================================================================
// listEvents
// ============================================================================

export const listEventsSchema = {
  name: 'listEvents',
  description:
    'List calendar events within a date range. Returns event summaries with subject, times, location, organizer, attendees, and optional metadata like sensitivity, importance, categories, and response status.',
  notes:
    'Returns only events that overlap the startDate–endDate window. Recurring events appear as RecurringMaster items (not expanded into individual occurrences); use calendarItemType to distinguish Single, RecurringMaster, Occurrence, and Exception items. Results are sorted by Start ascending by default; pass sortOrder to override. Set maxCount to 0 to return all matching events.',
  input: z.object({
    auth: AuthParam,
    startDate: z
      .string()
      .describe(
        'ISO 8601 start of the date range (e.g., "2024-01-15T00:00:00")',
      ),
    endDate: z
      .string()
      .describe('ISO 8601 end of the date range (e.g., "2024-01-22T23:59:59")'),
    maxCount: z
      .number()
      .optional()
      .default(50)
      .describe('Maximum number of events to return (default: 50)'),
    sortOrder: z
      .enum(['Ascending', 'Descending'])
      .optional()
      .describe(
        'Sort direction for events. Ascending = earliest first (default), Descending = latest first.',
      ),
    sortField: z
      .enum(['Start', 'End', 'Subject'])
      .optional()
      .default('Start')
      .describe('Field to sort by: Start (default), End, or Subject.'),
    folderId: z
      .string()
      .optional()
      .describe(
        'Target a specific calendar folder by its folder ID. When omitted, uses the default "calendar" distinguished folder. Use listFolders to discover folder IDs for shared or secondary calendars.',
      ),
  }),
  output: z.object({
    events: z
      .array(EventSummarySchema)
      .describe('List of calendar events in the date range'),
    totalCount: z
      .number()
      .describe(
        'Number of events returned (after date filtering and maxCount limit)',
      ),
  }),
};

// ============================================================================
// getEvent
// ============================================================================

export const getEventSchema = {
  name: 'getEvent',
  description:
    'Get full details of a single calendar event by item ID. Returns body, attendees, recurrence, reminder settings, sensitivity, importance, show-as status, online meeting info, and more.',
  notes: '',
  input: z.object({
    auth: AuthParam,
    itemId: z.string().describe('Immutable item ID of the calendar event'),
    bodyType: z
      .enum(['HTML', 'Text', 'Best'])
      .optional()
      .default('HTML')
      .describe(
        'Format for the event body: HTML (default), Text (plain text), or Best (server picks best format)',
      ),
    filterHtmlContent: z
      .boolean()
      .optional()
      .describe(
        'When true, strips potentially unsafe HTML content (scripts, forms, applets) from the body. Only applies when bodyType is HTML or Best.',
      ),
    addBlankTargetToLinks: z
      .boolean()
      .optional()
      .describe(
        'When true, adds target="_blank" to all links in the HTML body. Useful for safe link rendering.',
      ),
    blockExternalImages: z
      .boolean()
      .optional()
      .describe(
        'When true, blocks external image URLs in the HTML body. Useful for privacy or preventing tracking pixels.',
      ),
    includeMimeContent: z
      .boolean()
      .optional()
      .describe(
        'When true, includes the raw MIME content (base64-encoded iCalendar) in the response. Useful for exporting or forwarding calendar events.',
      ),
    maximumBodySize: z
      .number()
      .optional()
      .describe(
        'Maximum body size in bytes. When set, the body is truncated to this size and isTruncated is set to true in the response. Useful for previews.',
      ),
    inlineImageUrlTemplate: z
      .string()
      .optional()
      .describe(
        'URL template for inline images. Use {ContentId} as placeholder for the image content ID. When set, inline image src attributes are rewritten to use this template.',
      ),
  }),
  output: EventDetailSchema.extend({
    mimeContent: z
      .object({
        characterSet: z.string().describe('Character set of the MIME content'),
        value: z.string().describe('Base64-encoded MIME/iCalendar content'),
      })
      .optional()
      .describe(
        'Raw MIME content (iCalendar format), only present when includeMimeContent is true',
      ),
    isTruncated: z
      .boolean()
      .describe(
        'Whether the body was truncated due to maximumBodySize. Always present; false when body is not truncated.',
      ),
  }),
};

// ============================================================================
// updateEvent
// ============================================================================

export const updateEventSchema = {
  name: 'updateEvent',
  description:
    'Update an existing calendar event. Only provided fields are changed. Sends meeting update notifications to attendees when attendees exist.',
  notes:
    'Pass only the fields you want to change. Omitted fields are left unchanged. When attendees are present, update notifications are sent automatically.',
  input: z.object({
    auth: AuthParam,
    itemId: z
      .string()
      .describe('Immutable item ID of the calendar event to update'),
    subject: z.string().optional().describe('New event subject/title'),
    start: z
      .string()
      .optional()
      .describe(
        'New start time in ISO 8601 format (e.g., "2024-01-15T10:00:00")',
      ),
    end: z
      .string()
      .optional()
      .describe(
        'New end time in ISO 8601 format (e.g., "2024-01-15T11:00:00")',
      ),
    location: z.string().optional().describe('New event location'),
    body: z
      .string()
      .optional()
      .describe('New event description/agenda (HTML supported)'),
    requiredAttendees: z
      .array(z.string().email())
      .optional()
      .describe('Replace required attendees with these email addresses'),
    optionalAttendees: z
      .array(z.string().email())
      .optional()
      .describe('Replace optional attendees with these email addresses'),
    reminderMinutes: z
      .number()
      .optional()
      .describe(
        'Minutes before event to show reminder (e.g., 0, 5, 15, 30, 60)',
      ),
    isAllDay: z
      .boolean()
      .optional()
      .describe(
        'If true, converts to an all-day event; if false, converts back to a timed event',
      ),
    sensitivity: z
      .enum(['Normal', 'Personal', 'Private', 'Confidential'])
      .optional()
      .describe(
        'Event privacy level; Private hides details from others viewing your calendar',
      ),
    showAs: z
      .enum(['Free', 'Tentative', 'Busy', 'OOF', 'WorkingElsewhere', 'NoData'])
      .optional()
      .describe(
        'Free/busy status shown on the calendar. OOF = Out of Office, WorkingElsewhere = Working Elsewhere.',
      ),
    categories: z
      .array(z.string())
      .optional()
      .describe(
        'Category labels to apply (e.g., ["Blue category", "Green category"]). Replaces existing categories.',
      ),
    importance: z
      .enum(['Low', 'Normal', 'High'])
      .optional()
      .describe('Event importance/priority level'),
    isOnlineMeeting: z
      .boolean()
      .optional()
      .describe(
        'If true, adds an online meeting link (e.g., Teams) to the event',
      ),
    isResponseRequested: z
      .boolean()
      .optional()
      .describe(
        'Whether to request attendees to respond to the meeting invitation',
      ),
    allowNewTimeProposal: z
      .boolean()
      .optional()
      .describe('If true, attendees can propose a new meeting time'),
    charm: z
      .enum([
        'None',
        'Heart',
        'Car',
        'Cat',
        'Dog',
        'Music',
        'Travel',
        'Trophy',
        'Plane',
        'Soccer',
        'Star',
      ])
      .optional()
      .describe('Event icon charm displayed on the calendar'),
    doNotForwardMeeting: z
      .boolean()
      .optional()
      .describe(
        'If true, prevents attendees from forwarding the meeting invitation to others',
      ),
    hideAttendees: z
      .boolean()
      .optional()
      .describe(
        'If true, hides the attendee list so attendees only see themselves',
      ),
    onlineMeetingProvider: z
      .enum([
        'Unknown',
        'SkypeForBusiness',
        'SkypeForConsumer',
        'TeamsForBusiness',
      ])
      .optional()
      .describe(
        'Online meeting provider to use. Only applies when isOnlineMeeting is true.',
      ),
    startTimeZone: z
      .string()
      .optional()
      .describe(
        'Windows timezone ID for the event start time (e.g., "Eastern Standard Time", "UTC"). Overrides the mailbox default timezone for the start.',
      ),
    endTimeZone: z
      .string()
      .optional()
      .describe(
        'Windows timezone ID for the event end time (e.g., "Eastern Standard Time", "UTC"). Overrides the mailbox default timezone for the end.',
      ),
    isInPersonEvent: z
      .boolean()
      .optional()
      .describe(
        'If true, marks the event as an in-person event requiring physical attendance',
      ),
    recurrence: RecurrenceSchema.optional().describe(
      'Update the event recurrence. Specify a pattern (daily, weekly, monthly, yearly) and a range (end date, occurrence count, or no end). Replaces any existing recurrence.',
    ),
    isReminderSet: z
      .boolean()
      .optional()
      .describe(
        'If false, disables the reminder entirely. If true, enables the reminder (use reminderMinutes to set the time). By default reminders are enabled.',
      ),
    sendMeetingInvitationsOrCancellations: z
      .enum(['SendToNone', 'SendOnlyToAll', 'SendToAllAndSaveCopy'])
      .optional()
      .describe(
        'Controls whether meeting update notifications are sent to attendees. SendToNone = save silently, SendOnlyToAll = notify attendees, SendToAllAndSaveCopy = notify and save copy in Sent Items. Default: SendToAllAndSaveCopy for meetings, SendToNone for non-meeting events.',
      ),
    conflictResolution: z
      .enum(['NeverOverwrite', 'AutoResolve', 'AlwaysOverwrite'])
      .optional()
      .describe(
        'How to resolve conflicts when the event was modified since last read. AlwaysOverwrite (default) = force update, AutoResolve = server merges changes, NeverOverwrite = fail if changed.',
      ),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the event was updated successfully'),
    itemId: z.string().describe('ID of the updated calendar event'),
  }),
};

// ============================================================================
// deleteEvent
// ============================================================================

export const deleteEventSchema = {
  name: 'deleteEvent',
  description:
    'Delete a calendar event. Optionally sends cancellation notices to attendees.',
  notes: '',
  input: z.object({
    auth: AuthParam,
    itemId: z
      .string()
      .describe('Immutable item ID of the calendar event to delete'),
    sendCancellations: z
      .enum(['SendToNone', 'SendOnlyToAll', 'SendToAllAndSaveCopy'])
      .optional()
      .default('SendToAllAndSaveCopy')
      .describe(
        'Cancellation notice behavior: SendToNone = no notifications, SendOnlyToAll = notify attendees without saving a copy, SendToAllAndSaveCopy = notify attendees and save a copy in Sent Items (default)',
      ),
    deleteType: z
      .enum(['MoveToDeletedItems', 'SoftDelete', 'HardDelete'])
      .optional()
      .describe(
        'How to delete the item: MoveToDeletedItems = move to Deleted Items folder (default), SoftDelete = recoverable soft-delete bypassing Deleted Items, HardDelete = permanently delete with no recovery',
      ),
    suppressReadReceipts: z
      .boolean()
      .optional()
      .describe(
        'When true, suppresses read receipt generation for the deleted event',
      ),
    returnMovedItemIds: z
      .boolean()
      .optional()
      .describe(
        'When true and deleteType is MoveToDeletedItems, the response includes the new item ID in the Deleted Items folder',
      ),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the event was deleted successfully'),
    movedItemId: z
      .string()
      .optional()
      .describe(
        'New item ID in the Deleted Items folder. Only present when returnMovedItemIds is true and deleteType is MoveToDeletedItems.',
      ),
  }),
};

// ============================================================================
// Inferred Types
// ============================================================================

export type GetCalendarConfigInput = z.infer<
  typeof getCalendarConfigSchema.input
>;
export type GetCalendarConfigOutput = z.infer<
  typeof getCalendarConfigSchema.output
>;
export type GetRemindersInput = z.infer<typeof getRemindersSchema.input>;
export type GetRemindersOutput = z.infer<typeof getRemindersSchema.output>;
export type CreateEventInput = z.infer<typeof createEventSchema.input>;
export type CreateEventOutput = z.infer<typeof createEventSchema.output>;
export type AttendeeInfo = z.infer<typeof AttendeeInfoSchema>;
export type EventSummary = z.infer<typeof EventSummarySchema>;
export type EventDetail = z.infer<typeof EventDetailSchema>;
export type ListEventsInput = z.infer<typeof listEventsSchema.input>;
export type ListEventsOutput = z.infer<typeof listEventsSchema.output>;
export type GetEventInput = z.infer<typeof getEventSchema.input>;
export type GetEventOutput = z.infer<typeof getEventSchema.output>;
export type UpdateEventInput = z.infer<typeof updateEventSchema.input>;
export type UpdateEventOutput = z.infer<typeof updateEventSchema.output>;
export type DeleteEventInput = z.infer<typeof deleteEventSchema.input>;
export type DeleteEventOutput = z.infer<typeof deleteEventSchema.output>;
export type WeatherLocation = z.infer<typeof WeatherLocationSchema>;
export type RecurrencePattern = z.infer<typeof RecurrencePatternSchema>;
export type RecurrenceRange = z.infer<typeof RecurrenceRangeSchema>;
export type Recurrence = z.infer<typeof RecurrenceSchema>;
