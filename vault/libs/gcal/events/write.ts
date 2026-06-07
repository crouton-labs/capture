/**
 * Google Calendar Event Write Operations
 *
 * Create, edit, delete, and update calendar events.
 */

import { Validation, UpstreamError, throwForStatus } from '@vallum/_runtime';

import type {
  ClientHeader,
  CreateEventOutput,
  EditEventOutput,
  DeleteEventOutput,
  UpdateTimeOutput,
} from '../schemas';

import { bootstrapSyncContext } from '../context';
import { getEvent } from './read';
import {
  extractSyncToken,
  generateEventId,
  createGoogleMeetLink,
  buildEventMutation,
  buildDeleteMutation,
  buildSyncPayload,
  parseEventOptions,
} from '../helpers';

/**
 * Create a new calendar event.
 */
export async function createEvent(input: {
  syncToken?: string;
  clientHeader?: ClientHeader;
  secid?: string;
  account?: number;
  calendarId?: string;
  title: string;
  description?: string;
  location?: string;
  date: string;
  start: string;
  end?: string;
  duration?: number;
  attendees?: string[];
  meet?: boolean;
  recurrence?: 'daily' | 'weekly' | 'monthly' | 'yearly';
  recurrenceDays?: string[];
  timezone?: string;
}): Promise<CreateEventOutput> {
  // Auto-bootstrap context if not provided
  let context: {
    syncToken: string;
    clientHeader: ClientHeader;
    secid: string | undefined;
    account: number;
    calendarId: string;
  };

  if (!input.syncToken || !input.clientHeader) {
    const ctx = await bootstrapSyncContext({ account: input.account });
    context = {
      syncToken: ctx.syncToken,
      clientHeader: ctx.clientHeader,
      secid: ctx.secid,
      account: ctx.account,
      calendarId: ctx.calendarId,
    };
  } else {
    if (!input.calendarId || input.account === undefined) {
      throw new Validation(
        'calendarId and account are required when providing syncToken/clientHeader',
      );
    }
    context = {
      syncToken: input.syncToken,
      clientHeader: input.clientHeader,
      secid: input.secid,
      account: input.account,
      calendarId: input.calendarId,
    };
  }

  const { syncToken, clientHeader, secid, account, calendarId } = context;
  const { meet, recurrence, recurrenceDays } = input;

  if (!input.title) {
    throw new Validation('Event title is required');
  }

  const eventId = generateEventId();
  const eventOpts = parseEventOptions(input);

  // Create Google Meet link if requested
  let meetUrl: string | null = null;
  let conferenceData: { entryPoints: unknown; protobufData: unknown } | null =
    null;

  if (meet) {
    const meetResult = await createGoogleMeetLink(calendarId, eventId, account);
    if (meetResult) {
      meetUrl = meetResult.meetUrl;
      conferenceData = {
        entryPoints: meetResult.entryPoints,
        protobufData: meetResult.protobufData,
      };
    }
  }

  const mutation = buildEventMutation({
    eventId,
    title: eventOpts.title,
    description: eventOpts.description,
    location: eventOpts.location,
    startTime: eventOpts.startTime,
    endTime: eventOpts.endTime,
    ianaTimezone: eventOpts.timezone,
    attendees: eventOpts.attendees,
    conference: conferenceData,
    calendarId,
    recurrence: recurrence || null,
    recurrenceDays: recurrenceDays || null,
  });

  const payload = buildSyncPayload({
    clientHeader,
    syncToken,
    mutation,
  });

  const url = `https://calendar.google.com/calendar/u/${account}/sync.sync`;
  const body =
    'f.req=' +
    encodeURIComponent(payload) +
    '&cwuik=10&hl=en' +
    (secid ? '&secid=' + encodeURIComponent(secid) : '');

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'X-If-No-Redirect': '1',
    },
    credentials: 'include',
    body: body,
  });

  if (!resp.ok) {
    throwForStatus(resp.status);
  }

  const text = await resp.text();
  const newToken = extractSyncToken(text);

  return {
    success: true,
    eventId,
    meetUrl,
    newToken: !!newToken,
  };
}

/**
 * Edit an existing event (delete + recreate).
 */
export async function editEvent(input: {
  syncToken?: string;
  clientHeader?: ClientHeader;
  secid?: string;
  account?: number;
  calendarId?: string;
  eventId: string;
  eventDate: string;
  title?: string;
  description?: string;
  location?: string;
  date?: string;
  start?: string;
  end?: string;
  duration?: number;
  attendees?: string[];
  addAttendees?: string[];
  removeAttendees?: string[];
  meet?: boolean;
  recurrence?: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'none';
}): Promise<EditEventOutput> {
  // Auto-bootstrap context if not provided
  let context: {
    syncToken: string;
    clientHeader: ClientHeader;
    secid: string | undefined;
    account: number;
    calendarId: string;
  };

  if (!input.syncToken || !input.clientHeader) {
    const ctx = await bootstrapSyncContext({ account: input.account });
    context = {
      syncToken: ctx.syncToken,
      clientHeader: ctx.clientHeader,
      secid: ctx.secid,
      account: ctx.account,
      calendarId: ctx.calendarId,
    };
  } else {
    if (!input.calendarId || input.account === undefined) {
      throw new Validation(
        'calendarId and account are required when providing syncToken/clientHeader',
      );
    }
    context = {
      syncToken: input.syncToken,
      clientHeader: input.clientHeader,
      secid: input.secid,
      account: input.account,
      calendarId: input.calendarId,
    };
  }

  const { syncToken, clientHeader, secid, account, calendarId } = context;
  const { eventId, addAttendees = [], removeAttendees = [] } = input;

  // Check if any modification specified
  const hasModification =
    input.title !== undefined ||
    input.description !== undefined ||
    input.location !== undefined ||
    input.date !== undefined ||
    input.start !== undefined ||
    input.end !== undefined ||
    input.duration !== undefined ||
    input.attendees !== undefined ||
    addAttendees.length > 0 ||
    removeAttendees.length > 0 ||
    input.meet !== undefined ||
    input.recurrence !== undefined;

  if (!hasModification) {
    throw new Validation('At least one modification is required');
  }

  // Step 1: GET full event details
  const getResult = await getEvent({
    account,
    eventId,
    eventDate: input.eventDate,
  });

  if (!getResult.success) {
    throw new UpstreamError('Failed to get event details');
  }

  const originalEvent = getResult.event;

  // Parse original times
  const origStart = new Date(originalEvent.startTime as string);
  const origEnd = new Date(originalEvent.endTime as string);

  // Calculate original duration
  const originalDurationMs = origEnd.getTime() - origStart.getTime();
  const originalDurationMin = Math.round(originalDurationMs / 60000);

  // Determine new values
  const newTitle =
    input.title !== undefined ? input.title : originalEvent.title;
  const newDescription =
    input.description !== undefined
      ? input.description
      : originalEvent.description != null
        ? originalEvent.description
        : '';
  const newLocation =
    input.location !== undefined
      ? input.location
      : originalEvent.location != null
        ? originalEvent.location
        : '';

  // Handle date/time
  let newDate: string, newStart: string, newEnd: string | null;

  if (input.date) {
    newDate = input.date;
  } else {
    const tzOffset = origStart.getTimezoneOffset();
    const localStart = new Date(origStart.getTime() - tzOffset * 60000);
    newDate = localStart.toISOString().split('T')[0];
  }

  if (input.start) {
    newStart = input.start;
  } else {
    const tzOffset = origStart.getTimezoneOffset();
    const localStart = new Date(origStart.getTime() - tzOffset * 60000);
    newStart = localStart.toISOString().split('T')[1].substring(0, 5);
  }

  if (input.end) {
    newEnd = input.end;
  } else if (input.duration) {
    newEnd = null;
  } else if (input.start) {
    const [startHour, startMin] = input.start.split(':').map(Number);
    const endTotalMin = startHour * 60 + startMin + originalDurationMin;
    const endHour = Math.floor(endTotalMin / 60) % 24;
    const endMin = endTotalMin % 60;
    newEnd = `${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`;
  } else {
    const tzOffset = origEnd.getTimezoneOffset();
    const localEnd = new Date(origEnd.getTime() - tzOffset * 60000);
    newEnd = localEnd.toISOString().split('T')[1].substring(0, 5);
  }

  // Handle attendees
  let newAttendees: string[];
  if (input.attendees !== undefined) {
    newAttendees = input.attendees;
  } else {
    newAttendees = originalEvent.attendees
      .filter((a) => !a.self && !a.organizer)
      .map((a) => a.email);

    for (const email of addAttendees) {
      if (
        !newAttendees.map((e) => e.toLowerCase()).includes(email.toLowerCase())
      ) {
        newAttendees.push(email);
      }
    }

    const removeSet = new Set(removeAttendees.map((e) => e.toLowerCase()));
    newAttendees = newAttendees.filter(
      (email) => !removeSet.has(email.toLowerCase()),
    );
  }

  // Handle Meet
  const wantsMeet =
    input.meet === true ||
    (input.meet === undefined && !!originalEvent.meetLink);

  // Handle recurrence
  let newRecurrence: 'daily' | 'weekly' | 'monthly' | 'yearly' | null = null;
  if (input.recurrence !== undefined) {
    if (input.recurrence === 'none') {
      newRecurrence = null;
    } else {
      newRecurrence = input.recurrence;
    }
  } else if (originalEvent.recurrence && originalEvent.recurrence.length > 0) {
    const rrule = originalEvent.recurrence[0];
    const freqMatch = rrule.match(/FREQ=(\w+)/);
    if (freqMatch) {
      const freq = freqMatch[1].toLowerCase() as
        | 'daily'
        | 'weekly'
        | 'monthly'
        | 'yearly';
      if (['daily', 'weekly', 'monthly', 'yearly'].includes(freq)) {
        newRecurrence = freq;
      }
    }
  }

  // Validate
  if (newRecurrence && newAttendees.length === 0) {
    throw new Validation('Recurring events require at least one attendee');
  }

  // Step 2: DELETE old event
  const deleteResult = await deleteEvent({
    syncToken,
    clientHeader,
    secid,
    account,
    calendarId,
    eventId,
    eventDate: input.eventDate,
  });

  if (!deleteResult.success) {
    throw new UpstreamError('Failed to delete original event');
  }

  // Small delay
  await new Promise((r) => setTimeout(r, 1000));

  // Step 3: CREATE new event
  const createResult = await createEvent({
    syncToken,
    clientHeader,
    secid,
    account,
    calendarId,
    title: newTitle,
    description: newDescription,
    location: newLocation,
    date: newDate,
    start: newStart,
    end: newEnd || undefined,
    duration: input.duration || originalDurationMin,
    attendees: newAttendees,
    meet: wantsMeet,
    recurrence: newRecurrence || undefined,
  });

  if (!createResult.success) {
    throw new UpstreamError('Failed to create new event');
  }

  return {
    success: true,
    originalEventId: eventId,
    newEventId: createResult.eventId,
    meetUrl: createResult.meetUrl,
    changes: {
      title: input.title !== undefined,
      description: input.description !== undefined,
      location: input.location !== undefined,
      date: input.date !== undefined,
      time: input.start !== undefined || input.end !== undefined,
      attendees:
        input.attendees !== undefined ||
        addAttendees.length > 0 ||
        removeAttendees.length > 0,
      meet: input.meet !== undefined,
      recurrence: input.recurrence !== undefined,
    },
    event: {
      title: newTitle,
      date: newDate,
      start: newStart,
      end: newEnd,
      recurrence: newRecurrence,
      attendees: newAttendees,
    },
  };
}

/**
 * Delete a calendar event.
 */
export async function deleteEvent(input: {
  syncToken?: string;
  clientHeader?: ClientHeader;
  secid?: string;
  account?: number;
  calendarId?: string;
  eventId: string;
  eventDate: string;
}): Promise<DeleteEventOutput> {
  // Auto-bootstrap context if not provided
  let context: {
    syncToken: string;
    clientHeader: ClientHeader;
    secid: string | undefined;
    account: number;
    calendarId: string;
  };

  if (!input.syncToken || !input.clientHeader) {
    const ctx = await bootstrapSyncContext({ account: input.account });
    context = {
      syncToken: ctx.syncToken,
      clientHeader: ctx.clientHeader,
      secid: ctx.secid,
      account: ctx.account,
      calendarId: ctx.calendarId,
    };
  } else {
    if (!input.calendarId || input.account === undefined) {
      throw new Validation(
        'calendarId and account are required when providing syncToken/clientHeader',
      );
    }
    context = {
      syncToken: input.syncToken,
      clientHeader: input.clientHeader,
      secid: input.secid,
      account: input.account,
      calendarId: input.calendarId,
    };
  }

  const { syncToken, clientHeader, secid, account, calendarId } = context;
  const { eventId } = input;

  if (!eventId) {
    throw new Validation('Event ID is required');
  }

  // Verify event exists before attempting delete (sync.sync silently accepts invalid IDs)
  await getEvent({ account, eventId, eventDate: input.eventDate });

  const mutation = buildDeleteMutation({
    eventId,
    calendarId,
  });

  const payload = buildSyncPayload({
    clientHeader,
    syncToken,
    mutation,
  });

  const url = `https://calendar.google.com/calendar/u/${account}/sync.sync`;
  const body =
    'f.req=' +
    encodeURIComponent(payload) +
    '&cwuik=10&hl=en' +
    (secid ? '&secid=' + encodeURIComponent(secid) : '');

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'X-If-No-Redirect': '1',
    },
    credentials: 'include',
    body: body,
  });

  if (!resp.ok) {
    throwForStatus(resp.status);
  }

  const text = await resp.text();
  const newToken = extractSyncToken(text);

  return {
    success: true,
    eventId,
    newToken: !!newToken,
  };
}

/**
 * Update event time (operation type 9).
 */
export async function updateTime(input: {
  syncToken?: string;
  clientHeader?: ClientHeader;
  secid?: string;
  account?: number;
  calendarId?: string;
  eventId: string;
  eventDate: string;
  startMs: number;
  endMs: number;
}): Promise<UpdateTimeOutput> {
  // Auto-bootstrap context if not provided
  let context: {
    syncToken: string;
    clientHeader: ClientHeader;
    secid: string | undefined;
    account: number;
    calendarId: string;
  };

  if (!input.syncToken || !input.clientHeader) {
    const ctx = await bootstrapSyncContext({ account: input.account });
    context = {
      syncToken: ctx.syncToken,
      clientHeader: ctx.clientHeader,
      secid: ctx.secid,
      account: ctx.account,
      calendarId: ctx.calendarId,
    };
  } else {
    if (!input.calendarId || input.account === undefined) {
      throw new Validation(
        'calendarId and account are required when providing syncToken/clientHeader',
      );
    }
    context = {
      syncToken: input.syncToken,
      clientHeader: input.clientHeader,
      secid: input.secid,
      account: input.account,
      calendarId: input.calendarId,
    };
  }

  const { syncToken, clientHeader, secid, account, calendarId } = context;
  const { eventId, startMs, endMs } = input;

  if (!eventId) {
    throw new Validation('Event ID is required');
  }
  if (!startMs || !endMs) {
    throw new Validation('Both startMs and endMs are required');
  }

  // Verify event exists before attempting update (sync.sync silently accepts invalid IDs)
  await getEvent({ account, eventId, eventDate: input.eventDate });

  // Build time field
  const timeField = [
    [null, [null, [startMs]], [null, [endMs]], null, null, '2025b'],
  ];

  // Build mutation (operation type 9)
  const mutation = [
    9,
    null,
    [[null, [eventId, null, null, [timeField], 2]], calendarId],
    null,
    null,
    Math.floor(Math.random() * 1000),
  ];

  const payload = buildSyncPayload({
    clientHeader,
    syncToken,
    mutation,
  });

  const url = `https://calendar.google.com/calendar/u/${account}/sync.sync`;
  const body =
    'f.req=' +
    encodeURIComponent(payload) +
    '&cwuik=10&hl=en' +
    (secid ? '&secid=' + encodeURIComponent(secid) : '');

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'X-If-No-Redirect': '1',
    },
    credentials: 'include',
    body: body,
  });

  if (!resp.ok) {
    throwForStatus(resp.status);
  }

  const text = await resp.text();
  const newToken = extractSyncToken(text);

  return {
    success: true,
    eventId,
    newToken: !!newToken,
  };
}
