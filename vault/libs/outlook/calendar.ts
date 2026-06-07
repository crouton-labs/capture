/**
 * Outlook Calendar Functions
 *
 * Browser-executable calendar operations via OWA internal EWS-over-JSON APIs.
 * Requires user to be logged into Outlook at outlook.live.com or outlook.office.com.
 */

import type {
  AttendeeInfo,
  GetCalendarConfigInput,
  GetCalendarConfigOutput,
  GetRemindersInput,
  GetRemindersOutput,
  CreateEventInput,
  CreateEventOutput,
  ListEventsInput,
  ListEventsOutput,
  EventSummary,
  GetEventInput,
  GetEventOutput,
  UpdateEventInput,
  UpdateEventOutput,
  DeleteEventInput,
  DeleteEventOutput,
  OutlookAuth,
  Recurrence,
} from './schemas';
import { buildHeaders, buildEwsHeader, parseEmailAddress } from './helpers';
import { getContext } from './auth';
import { Validation, ContractDrift, throwForStatus } from '@vallum/_runtime';

// ============================================================================
// Local Helpers
// ============================================================================

/**
 * Parse an EWS Attendee array into AttendeeInfo objects.
 */
function parseAttendees(raw: unknown): AttendeeInfo[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((a: Record<string, unknown>) => {
    const mailbox = a.Mailbox as Record<string, unknown> | undefined;
    const parsed = mailbox
      ? parseEmailAddress(mailbox)
      : { name: '', email: '' };
    const responseType = (a.ResponseType as string) || 'Unknown';
    return { ...parsed, response: responseType };
  });
}

// ============================================================================
// getCalendarConfig
// ============================================================================

/**
 * Decode WorkDays bitmask into day name strings.
 * Bit mapping: Sunday=1, Monday=2, Tuesday=4, Wednesday=8, Thursday=16, Friday=32, Saturday=64.
 */
function decodeWorkDaysBitmask(bitmask: number): string[] {
  const dayMap: Array<[number, string]> = [
    [1, 'Sunday'],
    [2, 'Monday'],
    [4, 'Tuesday'],
    [8, 'Wednesday'],
    [16, 'Thursday'],
    [32, 'Friday'],
    [64, 'Saturday'],
  ];
  return dayMap
    .filter(([bit]) => (bitmask & bit) !== 0)
    .map(([, name]) => name);
}

/**
 * Convert minutes-since-midnight into HH:MM:SS string.
 */
function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

/**
 * Get calendar-specific mailbox settings (timezone, working hours, default meeting
 * duration, reminder settings, online meeting provider, weather, agenda, and more).
 */
export async function getCalendarConfig(
  params: GetCalendarConfigInput,
): Promise<GetCalendarConfigOutput> {
  const { auth } = params;

  const requestBody = {
    __type: 'GetMailboxCalendarConfigurationJsonRequest:#Exchange',
    Header: buildEwsHeader(auth),
    Body: {
      __type: 'GetMailboxCalendarConfigurationRequest:#Exchange',
    },
  };

  const origin = window.location.origin;
  const url = `${origin}/owa/0/service.svc?action=GetMailboxCalendarConfiguration&app=Calendar`;
  const headers = buildHeaders(auth, 'GetMailboxCalendarConfiguration');

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
    credentials: 'include',
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();

  // Response uses the Options format (top-level Options object)
  const opts = data?.Options as Record<string, unknown> | undefined;
  if (!opts) {
    throw new ContractDrift(
      'GetMailboxCalendarConfiguration returned no Options object',
    );
  }

  if (data.WasSuccessful === false) {
    const msg = (data.ErrorMessage as string) ?? 'Unknown error';
    throw new ContractDrift(`GetMailboxCalendarConfiguration error: ${msg}`);
  }

  // Timezone: WorkingHoursTimeZone.TimeZoneId
  const tzObj = opts.WorkingHoursTimeZone as
    | Record<string, unknown>
    | undefined;
  const timezone = (tzObj?.TimeZoneId as string) || auth.timezone;

  // Default reminder: numeric minutes
  const defaultReminderMinutes =
    typeof opts.DefaultReminderTime === 'number'
      ? opts.DefaultReminderTime
      : 15;

  // WorkDays: bitmask number (Sunday=1, Monday=2, Tuesday=4, ..., Saturday=64)
  const workDaysBitmask = opts.WorkDays as number | undefined;
  const workDays =
    typeof workDaysBitmask === 'number'
      ? decodeWorkDaysBitmask(workDaysBitmask)
      : [];

  // Start/end times: minutes since midnight
  const startMinutes = opts.WorkingHoursStartTime as number | undefined;
  const endMinutes = opts.WorkingHoursEndTime as number | undefined;

  const workingHours =
    workDays.length > 0
      ? {
          timeZone: timezone,
          workDays,
          startTime:
            typeof startMinutes === 'number'
              ? minutesToTime(startMinutes)
              : '08:00:00',
          endTime:
            typeof endMinutes === 'number'
              ? minutesToTime(endMinutes)
              : '17:00:00',
        }
      : undefined;

  const defaultOnlineMeetingProvider = opts.DefaultOnlineMeetingProvider as
    | string
    | undefined;

  // Weather locations
  const rawWeatherLocations = opts.WeatherLocations as
    | Array<Record<string, unknown>>
    | undefined;
  const weatherLocations = rawWeatherLocations?.map((loc) => ({
    name: (loc.Name as string) || '',
    longitude: (loc.Longitude as string) || '',
    latitude: (loc.Latitude as string) || '',
    locationId: (loc.LocationId as string) || '',
  }));

  return {
    timezone,
    workingHours,
    defaultReminderMinutes,
    defaultOnlineMeetingProvider,
    defaultMeetingDuration: opts.DefaultMeetingDuration as number | undefined,
    weekStartDay: opts.WeekStartDay as number | undefined,
    timeIncrement: opts.TimeIncrement as number | undefined,
    showWeekNumbers: opts.ShowWeekNumbers as boolean | undefined,
    firstWeekOfYear: opts.FirstWeekOfYear as number | undefined,
    remindersEnabled: opts.RemindersEnabled as boolean | undefined,
    reminderSoundEnabled: opts.ReminderSoundEnabled as boolean | undefined,
    addOnlineMeetingToAllEvents: opts.AddOnlineMeetingToAllEvents as
      | boolean
      | undefined,
    allowedOnlineMeetingProviders: opts.AllowedOnlineMeetingProviders as
      | string[]
      | undefined,
    weatherEnabled: opts.WeatherEnabled as number | undefined,
    weatherUnit: opts.WeatherUnit as number | undefined,
    weatherLocations,
    agendaMailEnabled: opts.AgendaMailEnabled as boolean | undefined,
    skipAgendaMailOnFreeDays: opts.SkipAgendaMailOnFreeDays as
      | boolean
      | undefined,
    eventsFromEmailEnabled: opts.EventsFromEmailEnabled as boolean | undefined,
    createEventsFromEmailAsPrivate: opts.CreateEventsFromEmailAsPrivate as
      | boolean
      | undefined,
    autoDeclineWhenBusy: opts.AutoDeclineWhenBusy as boolean | undefined,
    preserveDeclinedMeetings: opts.PreserveDeclinedMeetings as
      | boolean
      | undefined,
    deleteMeetingRequestOnRespond: opts.DeleteMeetingRequestOnRespond as
      | boolean
      | undefined,
  };
}

// ============================================================================
// getReminders
// ============================================================================

/**
 * Retrieve upcoming calendar event and task reminders within a time window.
 */
export async function getReminders(
  params: GetRemindersInput,
): Promise<GetRemindersOutput> {
  const { auth, beginTime, endTime, reminderType = 'All', maxItems } = params;

  const body: Record<string, unknown> = {
    __type: 'GetRemindersRequest:#Exchange',
    BeginTime: beginTime,
    EndTime: endTime,
    ReminderType: reminderType,
  };

  if (maxItems !== undefined) {
    body.MaxItems = maxItems;
  }

  const requestBody = {
    __type: 'GetRemindersJsonRequest:#Exchange',
    Header: buildEwsHeader(auth),
    Body: body,
  };

  const origin = window.location.origin;
  const url = `${origin}/owa/0/service.svc?action=GetReminders&app=Calendar`;
  const headers = buildHeaders(auth, 'GetReminders');

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
    credentials: 'include',
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();

  // GetReminders uses a flat Body shape (Body.Reminders, Body.ResponseClass),
  // NOT the standard ResponseMessages.Items envelope.
  const bodyResult = data?.Body as Record<string, unknown> | undefined;

  if (bodyResult?.ResponseClass === 'Error') {
    const msgPart = bodyResult.MessageText
      ? ` - ${bodyResult.MessageText as string}`
      : '';
    throw new ContractDrift(`GetReminders error: ${bodyResult.ResponseCode}${msgPart}`);
  }

  if (!bodyResult?.Reminders) {
    return { reminders: [] };
  }

  const rawReminders = bodyResult.Reminders as Array<Record<string, unknown>>;

  const reminders = rawReminders.map((r) => {
    const itemIdObj = r.ItemId as Record<string, string> | undefined;
    return {
      subject: r.Subject as string,
      itemId: itemIdObj ? itemIdObj.Id : '',
      changeKey: itemIdObj ? (itemIdObj.ChangeKey ?? '') : '',
      uid: (r.UID as string) ?? '',
      startDate: (r.StartDate as string) ?? (r.EventStartTime as string),
      endDate: (r.EndDate as string) ?? (r.EventEndTime as string),
      reminderTime: r.ReminderTime as string,
      location: typeof r.Location === 'string' ? r.Location : '',
      joinOnlineMeetingUrl: (r.JoinOnlineMeetingUrl as string) ?? '',
      reminderGroupType: (r.ReminderGroupTypes as number) ?? 0,
      isOccurrence: (r.IsOccurrence as boolean) ?? false,
      isMeeting: (r.IsMeeting as boolean) ?? false,
    };
  });

  return { reminders };
}

// ============================================================================
// Recurrence Helpers
// ============================================================================

/**
 * Build the EWS Recurrence sub-object from our simplified Recurrence input.
 */
function buildEwsRecurrence(recurrence: Recurrence): Record<string, unknown> {
  const { pattern, range } = recurrence;

  let recurrencePattern: Record<string, unknown>;

  switch (pattern.type) {
    case 'daily':
      recurrencePattern = {
        __type: 'DailyRecurrence:#Exchange',
        Interval: pattern.interval,
      };
      break;
    case 'weekly':
      recurrencePattern = {
        __type: 'WeeklyRecurrence:#Exchange',
        Interval: pattern.interval,
        DaysOfWeek: pattern.daysOfWeek.join(' '),
        FirstDayOfWeek: 'Sunday',
      };
      break;
    case 'absoluteMonthly':
      recurrencePattern = {
        __type: 'AbsoluteMonthlyRecurrence:#Exchange',
        Interval: pattern.interval,
        DayOfMonth: pattern.dayOfMonth,
      };
      break;
    case 'relativeMonthly':
      recurrencePattern = {
        __type: 'RelativeMonthlyRecurrence:#Exchange',
        Interval: pattern.interval,
        DaysOfWeek: pattern.daysOfWeek,
        DayOfWeekIndex: pattern.weekIndex,
      };
      break;
    case 'absoluteYearly':
      recurrencePattern = {
        __type: 'AbsoluteYearlyRecurrence:#Exchange',
        DayOfMonth: pattern.dayOfMonth,
        Month: pattern.month,
      };
      break;
    case 'relativeYearly':
      recurrencePattern = {
        __type: 'RelativeYearlyRecurrence:#Exchange',
        DaysOfWeek: pattern.daysOfWeek,
        DayOfWeekIndex: pattern.weekIndex,
        Month: pattern.month,
      };
      break;
  }

  let recurrenceRange: Record<string, unknown>;

  if (range.numberOfOccurrences) {
    recurrenceRange = {
      __type: 'NumberedRecurrence:#Exchange',
      StartDate: range.startDate,
      NumberOfOccurrences: range.numberOfOccurrences,
    };
  } else if (range.endDate) {
    recurrenceRange = {
      __type: 'EndDateRecurrence:#Exchange',
      StartDate: range.startDate,
      EndDate: range.endDate,
    };
  } else {
    recurrenceRange = {
      __type: 'NoEndRecurrence:#Exchange',
      StartDate: range.startDate,
    };
  }

  return {
    __type: 'RecurrenceType:#Exchange',
    RecurrencePattern: recurrencePattern,
    RecurrenceRange: recurrenceRange,
  };
}

// ============================================================================
// createEvent
// ============================================================================

/**
 * Create a new calendar event and send meeting invitations to attendees.
 */
export async function createEvent(
  params: CreateEventInput,
): Promise<CreateEventOutput> {
  let auth: OutlookAuth | undefined = params.auth;
  if (!auth) {
    const ctx = await getContext();
    auth = ctx.auth;
  }
  const {
    subject,
    start,
    end,
    location,
    body: eventBody,
    requiredAttendees,
    optionalAttendees,
    reminderMinutes = 15,
    isAllDay = false,
    showAs,
    sensitivity,
    categories,
    importance,
    isOnlineMeeting,
    isResponseRequested,
    allowNewTimeProposal,
    charm,
    doNotForwardMeeting,
    hideAttendees,
    onlineMeetingProvider,
    startTimeZone,
    endTimeZone,
    isInPersonEvent,
    recurrence,
  } = params;

  const hasAttendees =
    (requiredAttendees && requiredAttendees.length > 0) ||
    (optionalAttendees && optionalAttendees.length > 0);

  const calendarItem: Record<string, unknown> = {
    __type: 'CalendarItem:#Exchange',
    Subject: subject,
    Start: start,
    End: end,
    IsAllDayEvent: isAllDay,
    IsReminderSet: true,
    ReminderMinutesBeforeStart: String(reminderMinutes),
  };

  if (location) {
    calendarItem.Location = {
      __type: 'EnhancedLocation:#Exchange',
      DisplayName: location,
      Annotation: '',
    };
  }

  if (eventBody) {
    calendarItem.Body = {
      __type: 'BodyContentType:#Exchange',
      BodyType: 'HTML',
      Value: eventBody,
    };
  }

  if (requiredAttendees && requiredAttendees.length > 0) {
    calendarItem.RequiredAttendees = requiredAttendees.map((email) => ({
      __type: 'Attendee:#Exchange',
      Mailbox: {
        __type: 'Mailbox:#Exchange',
        EmailAddress: email,
        MailboxType: 'OneOff',
      },
    }));
  }

  if (optionalAttendees && optionalAttendees.length > 0) {
    calendarItem.OptionalAttendees = optionalAttendees.map((email) => ({
      __type: 'Attendee:#Exchange',
      Mailbox: {
        __type: 'Mailbox:#Exchange',
        EmailAddress: email,
        MailboxType: 'OneOff',
      },
    }));
  }

  if (showAs) {
    calendarItem.FreeBusyType = showAs;
  }

  if (sensitivity) {
    calendarItem.Sensitivity = sensitivity;
  }

  if (categories && categories.length > 0) {
    calendarItem.Categories = categories;
  }

  if (importance) {
    calendarItem.Importance = importance;
  }

  if (isResponseRequested !== undefined) {
    calendarItem.IsResponseRequested = isResponseRequested;
  }

  if (allowNewTimeProposal !== undefined) {
    calendarItem.AllowNewTimeProposal = allowNewTimeProposal;
  }

  if (charm) {
    calendarItem.Charm = charm;
  }

  if (doNotForwardMeeting !== undefined) {
    calendarItem.DoNotForwardMeeting = doNotForwardMeeting;
  }

  if (hideAttendees !== undefined) {
    calendarItem.HideAttendees = hideAttendees;
  }

  // IsOnlineMeeting is read-only on CreateItem; set OnlineMeetingProvider instead
  if (onlineMeetingProvider) {
    calendarItem.OnlineMeetingProvider = onlineMeetingProvider;
  } else if (isOnlineMeeting) {
    calendarItem.OnlineMeetingProvider = 'TeamsForLife';
  }

  if (startTimeZone) {
    calendarItem.StartTimeZone = {
      __type: 'TimeZoneDefinitionType:#Exchange',
      Id: startTimeZone,
    };
  }

  if (endTimeZone) {
    calendarItem.EndTimeZone = {
      __type: 'TimeZoneDefinitionType:#Exchange',
      Id: endTimeZone,
    };
  }

  if (isInPersonEvent !== undefined) {
    calendarItem.IsInPersonEvent = isInPersonEvent;
  }

  if (recurrence) {
    calendarItem.Recurrence = buildEwsRecurrence(recurrence);
  }

  const requestBody = {
    __type: 'CreateItemJsonRequest:#Exchange',
    Header: buildEwsHeader(auth),
    Body: {
      __type: 'CreateItemRequest:#Exchange',
      MessageDisposition: hasAttendees ? 'SendAndSaveCopy' : 'SaveOnly',
      SendMeetingInvitations: hasAttendees
        ? 'SendToAllAndSaveCopy'
        : 'SendToNone',
      Items: [calendarItem],
    },
  };

  const origin = window.location.origin;
  const url = `${origin}/owa/0/service.svc?action=CreateItem&app=Calendar`;
  const headers = buildHeaders(auth, 'CreateItem');

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
    credentials: 'include',
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();

  const responseItems = data?.Body?.ResponseMessages?.Items;
  if (Array.isArray(responseItems) && responseItems.length > 0) {
    const first = responseItems[0];
    if (first.ResponseClass === 'Error') {
      const msgPart = first.MessageText
        ? ` - ${first.MessageText as string}`
        : '';
      throw new ContractDrift(`CreateEvent error: ${first.ResponseCode}${msgPart}`);
    }

    const createdItem = first.Items?.[0] as Record<string, unknown> | undefined;
    const createdItemId = createdItem
      ? (createdItem.ItemId as Record<string, string>)?.Id
      : '';

    return {
      success: true,
      itemId: createdItemId,
    };
  }

  return {
    success: true,
    itemId: '',
  };
}

// ============================================================================
// listEvents
// ============================================================================

/**
 * Parse an event item from the EWS response into an EventSummary.
 */
function parseEventItem(item: Record<string, unknown>): EventSummary {
  const organizer = item.Organizer as Record<string, unknown> | undefined;
  const organizerMailbox = organizer?.Mailbox as
    | Record<string, unknown>
    | undefined;
  const locationObj = item.Location as
    | Record<string, unknown>
    | string
    | undefined;
  const locationStr =
    typeof locationObj === 'string'
      ? locationObj
      : ((locationObj?.DisplayName as string) ?? '');

  const reminderRaw = item.ReminderMinutesBeforeStart;
  const reminderMinutesBeforeStart =
    typeof reminderRaw === 'number'
      ? reminderRaw
      : reminderRaw != null
        ? parseInt(String(reminderRaw), 10)
        : undefined;

  const result: Record<string, unknown> = {
    itemId: (item.ItemId as Record<string, string>)?.Id ?? '',
    subject: (item.Subject as string) ?? '',
    start: (item.Start as string) ?? '',
    end: (item.End as string) ?? '',
    location: locationStr,
    organizer: organizerMailbox
      ? parseEmailAddress(organizerMailbox)
      : { name: '', email: '' },
    requiredAttendees: parseAttendees(item.RequiredAttendees),
    optionalAttendees: parseAttendees(item.OptionalAttendees),
    isAllDay: (item.IsAllDayEvent as boolean) ?? false,
    isCancelled: (item.IsCancelled as boolean) ?? false,
    isRecurring:
      (item.IsRecurring as boolean) ||
      item.CalendarItemType === 'RecurringMaster' ||
      item.CalendarItemType === 'Occurrence' ||
      item.CalendarItemType === 'Exception',
  };

  // Optional fields: only include when present in the API response
  if (item.Sensitivity != null) result.sensitivity = item.Sensitivity as string;
  if (item.IsMeeting != null) result.isMeeting = item.IsMeeting as boolean;
  if (item.CalendarItemType != null)
    result.calendarItemType = item.CalendarItemType as string;
  if (item.Categories != null) result.categories = item.Categories as string[];
  if (item.HasAttachments != null)
    result.hasAttachments = item.HasAttachments as boolean;
  if (item.Importance != null) result.importance = item.Importance as string;
  if (item.ResponseType != null)
    result.responseType = item.ResponseType as string;
  if (item.Preview != null) result.preview = item.Preview as string;
  if (
    reminderMinutesBeforeStart != null &&
    !isNaN(reminderMinutesBeforeStart)
  ) {
    result.reminderMinutesBeforeStart = reminderMinutesBeforeStart;
  }
  if (item.IsOrganizer != null)
    result.isOrganizer = item.IsOrganizer as boolean;
  if (item.StartTimeZoneId != null)
    result.startTimeZoneId = item.StartTimeZoneId as string;
  if (item.EndTimeZoneId != null)
    result.endTimeZoneId = item.EndTimeZoneId as string;
  if (item.FreeBusyType != null)
    result.freeBusyType = item.FreeBusyType as string;
  if (item.Charm != null) result.charm = item.Charm as string;

  return result as EventSummary;
}

/**
 * List calendar events within a date range using CalendarView expansion.
 * OWA's CalendarView filtering is unreliable; events are post-filtered
 * client-side to guarantee the returned events fall within the requested
 * date range and respect maxCount.
 */
export async function listEvents(
  params: ListEventsInput,
): Promise<ListEventsOutput> {
  let auth: OutlookAuth | undefined = params.auth;
  if (!auth) {
    const ctx = await getContext();
    auth = ctx.auth;
  }
  const {
    startDate,
    endDate,
    maxCount = 50,
    sortOrder,
    sortField = 'Start',
    folderId,
  } = params;

  if (!startDate) {
    throw new Validation('listEvents: startDate is required');
  }
  if (!endDate) {
    throw new Validation('listEvents: endDate is required');
  }

  const body: Record<string, unknown> = {
    __type: 'FindItemRequest:#Exchange',
    ItemShape: {
      __type: 'ItemResponseShape:#Exchange',
      BaseShape: 'Default',
      AdditionalProperties: [
        { __type: 'PropertyUri:#Exchange', FieldURI: 'EnhancedLocation' },
        { __type: 'PropertyUri:#Exchange', FieldURI: 'Organizer' },
        { __type: 'PropertyUri:#Exchange', FieldURI: 'RequiredAttendees' },
        { __type: 'PropertyUri:#Exchange', FieldURI: 'OptionalAttendees' },
        { __type: 'PropertyUri:#Exchange', FieldURI: 'IsAllDayEvent' },
        { __type: 'PropertyUri:#Exchange', FieldURI: 'IsCancelled' },
        { __type: 'PropertyUri:#Exchange', FieldURI: 'IsRecurring' },
        { __type: 'PropertyUri:#Exchange', FieldURI: 'Categories' },
        { __type: 'PropertyUri:#Exchange', FieldURI: 'IsOrganizer' },
        { __type: 'PropertyUri:#Exchange', FieldURI: 'Sensitivity' },
        { __type: 'PropertyUri:#Exchange', FieldURI: 'Importance' },
        { __type: 'PropertyUri:#Exchange', FieldURI: 'Preview' },
        {
          __type: 'PropertyUri:#Exchange',
          FieldURI: 'ReminderMinutesBeforeStart',
        },
        { __type: 'PropertyUri:#Exchange', FieldURI: 'IsMeeting' },
        { __type: 'PropertyUri:#Exchange', FieldURI: 'ResponseType' },
        { __type: 'PropertyUri:#Exchange', FieldURI: 'StartTimeZoneId' },
        { __type: 'PropertyUri:#Exchange', FieldURI: 'EndTimeZoneId' },
      ],
    },
    ParentFolderIds: [
      folderId
        ? { __type: 'FolderId:#Exchange', Id: folderId }
        : { __type: 'DistinguishedFolderId:#Exchange', Id: 'calendar' },
    ],
    Traversal: 'Shallow',
    CalendarView: {
      __type: 'CalendarView:#Exchange',
      StartDate: startDate,
      EndDate: endDate,
      MaxEntriesReturned: maxCount,
    },
  };

  // Default sort: ascending by Start when no explicit sortOrder.
  // This ensures predictable ordering even when the caller omits sortOrder.
  body.SortOrder = [
    {
      __type: 'SortResults:#Exchange',
      Order: sortOrder ?? 'Ascending',
      Path: {
        __type: 'PropertyUri:#Exchange',
        FieldURI: sortField,
      },
    },
  ];

  const requestBody: Record<string, unknown> = {
    __type: 'FindItemJsonRequest:#Exchange',
    Header: buildEwsHeader(auth),
    Body: body,
  };

  const origin = window.location.origin;
  const url = `${origin}/owa/0/service.svc?action=FindItem&app=Calendar`;
  const headers = buildHeaders(auth, 'FindItem');

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
    credentials: 'include',
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();

  const responseItems = data?.Body?.ResponseMessages?.Items;
  if (!Array.isArray(responseItems) || responseItems.length === 0) {
    return { events: [], totalCount: 0 };
  }

  const findResult = responseItems[0];
  if (findResult.ResponseClass === 'Error') {
    const msgPart = findResult.MessageText
      ? ` - ${findResult.MessageText as string}`
      : '';
    throw new ContractDrift(
      `FindItem (calendar) error: ${findResult.ResponseCode}${msgPart}`,
    );
  }

  const rootFolder = findResult.RootFolder;
  const items = (rootFolder?.Items ?? []) as Array<Record<string, unknown>>;

  // Parse all items from the API response.
  const allEvents = items.map(parseEventItem);

  // OWA's CalendarView date filtering is unreliable on consumer accounts;
  // post-filter to guarantee only events overlapping the requested window
  // are returned. An event overlaps the window when:
  //   eventEnd > windowStart  AND  eventStart < windowEnd
  const windowStart = new Date(startDate).getTime();
  const windowEnd = new Date(endDate).getTime();

  const filtered = allEvents.filter((ev) => {
    const evStart = new Date(ev.start).getTime();
    const evEnd = new Date(ev.end).getTime();
    return evEnd > windowStart && evStart < windowEnd;
  });

  // Enforce maxCount after filtering.
  const limited = maxCount > 0 ? filtered.slice(0, maxCount) : filtered;

  return { events: limited, totalCount: limited.length };
}

// ============================================================================
// getEvent
// ============================================================================

/**
 * Get full details of a single calendar event by item ID.
 */
export async function getEvent(params: GetEventInput): Promise<GetEventOutput> {
  const {
    auth,
    itemId,
    bodyType = 'HTML',
    filterHtmlContent,
    addBlankTargetToLinks,
    blockExternalImages,
    includeMimeContent,
    maximumBodySize,
    inlineImageUrlTemplate,
  } = params;

  const itemShape: Record<string, unknown> = {
    __type: 'ItemResponseShape:#Exchange',
    BaseShape: 'IdOnly',
    AdditionalProperties: [
      { __type: 'PropertyUri:#Exchange', FieldURI: 'Subject' },
      { __type: 'PropertyUri:#Exchange', FieldURI: 'Body' },
      { __type: 'PropertyUri:#Exchange', FieldURI: 'Start' },
      { __type: 'PropertyUri:#Exchange', FieldURI: 'End' },
      { __type: 'PropertyUri:#Exchange', FieldURI: 'EnhancedLocation' },
      { __type: 'PropertyUri:#Exchange', FieldURI: 'Organizer' },
      { __type: 'PropertyUri:#Exchange', FieldURI: 'RequiredAttendees' },
      { __type: 'PropertyUri:#Exchange', FieldURI: 'OptionalAttendees' },
      { __type: 'PropertyUri:#Exchange', FieldURI: 'IsAllDayEvent' },
      { __type: 'PropertyUri:#Exchange', FieldURI: 'IsRecurring' },
      { __type: 'PropertyUri:#Exchange', FieldURI: 'IsCancelled' },
      { __type: 'PropertyUri:#Exchange', FieldURI: 'Recurrence' },
      {
        __type: 'PropertyUri:#Exchange',
        FieldURI: 'ReminderMinutesBeforeStart',
      },
      { __type: 'PropertyUri:#Exchange', FieldURI: 'Categories' },
      { __type: 'PropertyUri:#Exchange', FieldURI: 'Sensitivity' },
      { __type: 'PropertyUri:#Exchange', FieldURI: 'Importance' },
      {
        __type: 'PropertyUri:#Exchange',
        FieldURI: 'LegacyFreeBusyStatus',
      },
      { __type: 'PropertyUri:#Exchange', FieldURI: 'HasAttachments' },
      { __type: 'PropertyUri:#Exchange', FieldURI: 'IsOnlineMeeting' },
      { __type: 'PropertyUri:#Exchange', FieldURI: 'CalendarItemType' },
      { __type: 'PropertyUri:#Exchange', FieldURI: 'ResponseType' },
      { __type: 'PropertyUri:#Exchange', FieldURI: 'IsOrganizer' },
      { __type: 'PropertyUri:#Exchange', FieldURI: 'Duration' },
      { __type: 'PropertyUri:#Exchange', FieldURI: 'UID' },
      { __type: 'PropertyUri:#Exchange', FieldURI: 'IsMeeting' },
      { __type: 'PropertyUri:#Exchange', FieldURI: 'DateTimeCreated' },
      { __type: 'PropertyUri:#Exchange', FieldURI: 'StartTimeZoneId' },
      { __type: 'PropertyUri:#Exchange', FieldURI: 'EndTimeZoneId' },
      {
        __type: 'PropertyUri:#Exchange',
        FieldURI: 'JoinOnlineMeetingUrl',
      },
      { __type: 'PropertyUri:#Exchange', FieldURI: 'Charm' },
    ],
    BodyType: bodyType,
  };

  if (filterHtmlContent != null)
    itemShape.FilterHtmlContent = filterHtmlContent;
  if (addBlankTargetToLinks != null)
    itemShape.AddBlankTargetToLinks = addBlankTargetToLinks;
  if (blockExternalImages != null)
    itemShape.BlockExternalImages = blockExternalImages;
  if (includeMimeContent != null)
    itemShape.IncludeMimeContent = includeMimeContent;
  if (maximumBodySize != null) itemShape.MaximumBodySize = maximumBodySize;
  if (inlineImageUrlTemplate != null)
    itemShape.InlineImageUrlTemplate = inlineImageUrlTemplate;

  const requestBody: Record<string, unknown> = {
    __type: 'GetItemJsonRequest:#Exchange',
    Header: buildEwsHeader(auth),
    Body: {
      __type: 'GetItemRequest:#Exchange',
      ItemShape: itemShape,
      ItemIds: [{ __type: 'ItemId:#Exchange', Id: itemId }],
    },
  };

  const origin = window.location.origin;
  const url = `${origin}/owa/0/service.svc?action=GetItem&app=Calendar`;
  const headers = buildHeaders(auth, 'GetItem');

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
    credentials: 'include',
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();

  const responseItems = data?.Body?.ResponseMessages?.Items;
  if (!Array.isArray(responseItems) || responseItems.length === 0) {
    throw new ContractDrift(
      `GetItem returned no items for calendar event ID: ${itemId}`,
    );
  }

  const result = responseItems[0];
  if (result.ResponseClass === 'Error') {
    const msgPart = result.MessageText
      ? ` - ${result.MessageText as string}`
      : '';
    throw new ContractDrift(
      `GetItem (calendar) error: ${result.ResponseCode}${msgPart}`,
    );
  }

  const item = (result.Items?.[0] ?? result) as Record<string, unknown>;

  const organizer = item.Organizer as Record<string, unknown> | undefined;
  const organizerMailbox = organizer?.Mailbox as
    | Record<string, unknown>
    | undefined;
  const bodyObj = item.Body as Record<string, unknown> | undefined;
  const htmlBody = (bodyObj?.Value as string) ?? '';
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = htmlBody;
  const textBody = tempDiv.textContent ?? tempDiv.innerText ?? '';

  const locationObj = item.Location as
    | Record<string, unknown>
    | string
    | undefined;
  const locationStr =
    typeof locationObj === 'string'
      ? locationObj
      : ((locationObj?.DisplayName as string) ?? '');

  const recurrenceObj = item.Recurrence as
    | Record<string, unknown>
    | null
    | undefined;
  let recurrence: string | null = null;
  if (recurrenceObj) {
    recurrence = JSON.stringify(recurrenceObj);
  }

  const reminderRaw = item.ReminderMinutesBeforeStart;
  const reminderMinutes =
    typeof reminderRaw === 'number'
      ? reminderRaw
      : parseInt(String(reminderRaw ?? '15'), 10);

  const output: Record<string, unknown> = {
    itemId: (item.ItemId as Record<string, string>)?.Id ?? itemId,
    subject: (item.Subject as string) ?? '',
    body: htmlBody,
    bodyText: textBody,
    start: (item.Start as string) ?? '',
    end: (item.End as string) ?? '',
    location: locationStr,
    organizer: organizerMailbox
      ? parseEmailAddress(organizerMailbox)
      : { name: '', email: '' },
    requiredAttendees: parseAttendees(item.RequiredAttendees),
    optionalAttendees: parseAttendees(item.OptionalAttendees),
    isAllDay: (item.IsAllDayEvent as boolean) ?? false,
    isRecurring: (item.IsRecurring as boolean) ?? false,
    isCancelled: (item.IsCancelled as boolean) ?? false,
    recurrence,
    reminderMinutes,
    categories: (item.Categories as string[]) ?? [],
    sensitivity: ((item.Sensitivity as string) ??
      'Normal') as GetEventOutput['sensitivity'],
    importance: ((item.Importance as string) ??
      'Normal') as GetEventOutput['importance'],
    freeBusyType: ((item.FreeBusyType as string) ??
      'Busy') as GetEventOutput['freeBusyType'],
    hasAttachments: (item.HasAttachments as boolean) ?? false,
    isOnlineMeeting: (item.IsOnlineMeeting as boolean) ?? false,
    isMeeting: (item.IsMeeting as boolean) ?? false,
    isOrganizer: (item.IsOrganizer as boolean) ?? false,
    calendarItemType: ((item.CalendarItemType as string) ??
      'Single') as GetEventOutput['calendarItemType'],
    responseType: ((item.ResponseType as string) ??
      'Unknown') as GetEventOutput['responseType'],
    duration: (item.Duration as string) ?? '',
    uid: (item.UID as string) ?? '',
    dateTimeCreated: (item.DateTimeCreated as string) ?? '',
    startTimeZoneId: (item.StartTimeZoneId as string) ?? '',
    endTimeZoneId: (item.EndTimeZoneId as string) ?? '',
    onlineMeetingJoinUrl: (item.JoinOnlineMeetingUrl as string) ?? '',
    charm: ((item.Charm as string) ?? 'None') as GetEventOutput['charm'],
    isTruncated: (bodyObj?.IsTruncated as boolean) ?? false,
  };

  // Include MIME content if requested and present
  const mimeContent = item.MimeContent as Record<string, unknown> | undefined;
  if (mimeContent?.Value) {
    output.mimeContent = {
      characterSet: (mimeContent.CharacterSet as string) || 'UTF-8',
      value: mimeContent.Value as string,
    };
  }

  return output as GetEventOutput;
}

// ============================================================================
// updateEvent
// ============================================================================

/**
 * Build a SetItemField change entry for EWS UpdateItem.
 */
function setField(fieldUri: string, value: unknown): Record<string, unknown> {
  return {
    __type: 'SetItemField:#Exchange',
    Item: {
      __type: 'CalendarItem:#Exchange',
      [fieldUri]: value,
    },
    Path: {
      __type: 'PropertyUri:#Exchange',
      FieldURI: fieldUri,
    },
  };
}

/**
 * Update an existing calendar event via OWA EWS UpdateItem.
 */
export async function updateEvent(
  params: UpdateEventInput,
): Promise<UpdateEventOutput> {
  let auth: OutlookAuth | undefined = params.auth;
  if (!auth) {
    const ctx = await getContext();
    auth = ctx.auth;
  }
  const {
    itemId,
    subject,
    start,
    end,
    location,
    body: eventBody,
    requiredAttendees,
    optionalAttendees,
    reminderMinutes,
    isAllDay,
    sensitivity,
    showAs,
    categories,
    importance,
    isOnlineMeeting,
    isResponseRequested,
    allowNewTimeProposal,
    charm,
    doNotForwardMeeting,
    hideAttendees,
    onlineMeetingProvider,
    startTimeZone,
    endTimeZone,
    isInPersonEvent,
    recurrence,
    isReminderSet,
    sendMeetingInvitationsOrCancellations,
    conflictResolution,
  } = params;

  const changes: Array<Record<string, unknown>> = [];

  if (subject !== undefined) {
    changes.push(setField('Subject', subject));
  }

  if (start !== undefined) {
    changes.push(setField('Start', start));
  }

  if (end !== undefined) {
    changes.push(setField('End', end));
  }

  if (location !== undefined) {
    changes.push({
      __type: 'SetItemField:#Exchange',
      Item: {
        __type: 'CalendarItem:#Exchange',
        Location: {
          __type: 'EnhancedLocation:#Exchange',
          DisplayName: location,
        },
      },
      Path: {
        __type: 'PropertyUri:#Exchange',
        FieldURI: 'EnhancedLocation',
      },
    });
  }

  if (eventBody !== undefined) {
    changes.push(
      setField('Body', {
        __type: 'BodyContentType:#Exchange',
        BodyType: 'HTML',
        Value: eventBody,
      }),
    );
  }

  if (requiredAttendees !== undefined) {
    changes.push(
      setField(
        'RequiredAttendees',
        requiredAttendees.map((email) => ({
          __type: 'Attendee:#Exchange',
          Mailbox: {
            __type: 'Mailbox:#Exchange',
            EmailAddress: email,
            MailboxType: 'OneOff',
          },
        })),
      ),
    );
  }

  if (optionalAttendees !== undefined) {
    changes.push(
      setField(
        'OptionalAttendees',
        optionalAttendees.map((email) => ({
          __type: 'Attendee:#Exchange',
          Mailbox: {
            __type: 'Mailbox:#Exchange',
            EmailAddress: email,
            MailboxType: 'OneOff',
          },
        })),
      ),
    );
  }

  if (reminderMinutes !== undefined) {
    changes.push(
      setField('ReminderMinutesBeforeStart', String(reminderMinutes)),
    );
  }

  if (isReminderSet !== undefined) {
    changes.push(setField('IsReminderSet', isReminderSet));
  }

  if (isAllDay !== undefined) {
    changes.push(setField('IsAllDayEvent', isAllDay));
  }

  if (sensitivity !== undefined) {
    changes.push(setField('Sensitivity', sensitivity));
  }

  if (showAs !== undefined) {
    changes.push(setField('FreeBusyType', showAs));
  }

  if (categories !== undefined) {
    changes.push(setField('Categories', categories));
  }

  if (importance !== undefined) {
    changes.push(setField('Importance', importance));
  }

  if (isResponseRequested !== undefined) {
    changes.push(setField('IsResponseRequested', isResponseRequested));
  }

  if (allowNewTimeProposal !== undefined) {
    changes.push(setField('AllowNewTimeProposal', allowNewTimeProposal));
  }

  if (charm !== undefined) {
    changes.push(setField('Charm', charm));
  }

  if (doNotForwardMeeting !== undefined) {
    changes.push(setField('DoNotForwardMeeting', doNotForwardMeeting));
  }

  if (hideAttendees !== undefined) {
    changes.push(setField('HideAttendees', hideAttendees));
  }

  if (isOnlineMeeting !== undefined && isOnlineMeeting) {
    changes.push(
      setField(
        'OnlineMeetingProvider',
        onlineMeetingProvider ?? 'TeamsForLife',
      ),
    );
  } else if (onlineMeetingProvider !== undefined) {
    changes.push(setField('OnlineMeetingProvider', onlineMeetingProvider));
  }

  if (isInPersonEvent !== undefined) {
    changes.push(setField('IsInPersonEvent', isInPersonEvent));
  }

  if (startTimeZone !== undefined) {
    changes.push(
      setField('StartTimeZone', {
        __type: 'TimeZoneDefinitionType:#Exchange',
        Id: startTimeZone,
      }),
    );
  }

  if (endTimeZone !== undefined) {
    changes.push(
      setField('EndTimeZone', {
        __type: 'TimeZoneDefinitionType:#Exchange',
        Id: endTimeZone,
      }),
    );
  }

  if (recurrence !== undefined) {
    changes.push(setField('Recurrence', buildEwsRecurrence(recurrence)));
  }

  if (changes.length === 0) {
    return { success: true, itemId };
  }

  // Determine whether this is a meeting (has attendees) for notification default
  const hasAttendees =
    (requiredAttendees && requiredAttendees.length > 0) ||
    (optionalAttendees && optionalAttendees.length > 0);

  const smiorc =
    sendMeetingInvitationsOrCancellations ??
    (hasAttendees ? 'SendToAllAndSaveCopy' : 'SendToNone');

  const requestBody: Record<string, unknown> = {
    __type: 'UpdateItemJsonRequest:#Exchange',
    Header: buildEwsHeader(auth),
    Body: {
      __type: 'UpdateItemRequest:#Exchange',
      ConflictResolution: conflictResolution ?? 'AlwaysOverwrite',
      MessageDisposition: 'SaveOnly',
      SendCalendarInvitationsOrCancellations: smiorc,
      ItemChanges: [
        {
          __type: 'ItemChange:#Exchange',
          ItemId: {
            __type: 'ItemId:#Exchange',
            Id: itemId,
          },
          Updates: changes,
        },
      ],
    },
  };

  const origin = window.location.origin;
  const url = `${origin}/owa/0/service.svc?action=UpdateItem&app=Calendar`;
  const headers = buildHeaders(auth, 'UpdateItem');

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
    credentials: 'include',
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();

  const responseItems = data?.Body?.ResponseMessages?.Items;
  if (Array.isArray(responseItems) && responseItems.length > 0) {
    const first = responseItems[0];
    if (first.ResponseClass === 'Error') {
      const msgPart = first.MessageText
        ? ` - ${first.MessageText as string}`
        : '';
      throw new ContractDrift(`updateEvent error: ${first.ResponseCode}${msgPart}`);
    }

    const updatedItem = first.Items?.[0] as Record<string, unknown> | undefined;
    const updatedItemId = updatedItem
      ? (updatedItem.ItemId as Record<string, string>)?.Id
      : itemId;

    return { success: true, itemId: updatedItemId || itemId };
  }

  return { success: true, itemId };
}

// ============================================================================
// deleteEvent
// ============================================================================

/**
 * Delete a calendar event and optionally send cancellation notices.
 */
export async function deleteEvent(
  params: DeleteEventInput,
): Promise<DeleteEventOutput> {
  let auth: OutlookAuth | undefined = params.auth;
  if (!auth) {
    const ctx = await getContext();
    auth = ctx.auth;
  }
  const {
    itemId,
    sendCancellations = 'SendToAllAndSaveCopy',
    deleteType,
    suppressReadReceipts,
    returnMovedItemIds,
  } = params;

  const body: Record<string, unknown> = {
    __type: 'DeleteItemRequest:#Exchange',
    DeleteType: deleteType ?? 'MoveToDeletedItems',
    SendMeetingCancellations: sendCancellations,
    ItemIds: [{ __type: 'ItemId:#Exchange', Id: itemId }],
  };

  if (suppressReadReceipts !== undefined) {
    body.SuppressReadReceipts = suppressReadReceipts;
  }
  if (returnMovedItemIds !== undefined) {
    body.ReturnMovedItemIds = returnMovedItemIds;
  }

  const requestBody: Record<string, unknown> = {
    __type: 'DeleteItemJsonRequest:#Exchange',
    Header: buildEwsHeader(auth),
    Body: body,
  };

  const origin = window.location.origin;
  const url = `${origin}/owa/0/service.svc?action=DeleteItem&app=Calendar`;
  const headers = buildHeaders(auth, 'DeleteItem');

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
    credentials: 'include',
  });

  if (!response.ok) throwForStatus(response.status, await response.text().catch(() => undefined));

  const data = await response.json();

  const responseItems = data?.Body?.ResponseMessages?.Items;
  if (Array.isArray(responseItems)) {
    for (const item of responseItems) {
      if (item.ResponseClass === 'Error') {
        const msgPart = item.MessageText
          ? ` - ${item.MessageText as string}`
          : '';
        throw new ContractDrift(`deleteEvent error: ${item.ResponseCode}${msgPart}`);
      }
    }
  }

  const result: DeleteEventOutput = { success: true };

  if (returnMovedItemIds && responseItems?.[0]?.MovedItemId?.Id) {
    result.movedItemId = responseItems[0].MovedItemId.Id as string;
  }

  return result;
}
