/**
 * Google Calendar Internal Helpers
 *
 * Shared utilities for Calendar API operations.
 */

import { ContractDrift, Validation } from '@vallum/_runtime';

import type { ClientHeader, Attendee, EventDetail } from '../schemas';

/**
 * Extract sync token from a sync.sync response.
 */
export function extractSyncToken(responseText: string): string | null {
  try {
    let jsonText = responseText;
    if (jsonText.startsWith(")]}'\n")) {
      jsonText = jsonText.substring(5);
    } else if (jsonText.startsWith(")]}'")) {
      jsonText = jsonText.substring(4);
    }

    const parsed = JSON.parse(jsonText);

    if (parsed?.[0]?.[2]?.[1]?.[0]) {
      return parsed[0][2][1][0];
    }

    return null;
  } catch (e) {
    throw new ContractDrift(`Failed to extract sync token: ${(e as Error).message}`);
  }
}

/**
 * Generate a random event ID (26 alphanumeric characters).
 */
export function generateEventId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 26; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

/**
 * Create a Google Meet link for an event.
 * This must be called BEFORE createEvent and the returned conferenceData
 * must be passed to createEvent.
 */
export async function createGoogleMeetLink(
  calendarId: string,
  eventId: string,
  accountNum: number,
): Promise<{
  meetUrl: string;
  meetCode: string;
  entryPoints: unknown;
  protobufData: unknown;
} | null> {
  // Get SAPISID cookies from browser
  const cookies = document.cookie.split(';').reduce(
    (acc, c) => {
      const [k, v] = c.trim().split('=');
      acc[k] = v;
      return acc;
    },
    {} as Record<string, string>,
  );

  const sapisid = cookies['SAPISID'];
  const sapisid1p = cookies['__Secure-1PSAPISID'];
  const sapisid3p = cookies['__Secure-3PSAPISID'];

  if (!sapisid && !sapisid1p && !sapisid3p) {
    console.error('createGoogleMeetLink: No SAPISID cookies found');
    return null;
  }

  const origin = 'https://calendar.google.com';
  const timestamp = Math.floor(Date.now() / 1000);

  // Generate SAPISIDHASH for authorization
  async function makeHash(sid: string): Promise<string> {
    const input = timestamp + ' ' + sid + ' ' + origin;
    const hashBuffer = await crypto.subtle.digest(
      'SHA-1',
      new TextEncoder().encode(input),
    );
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return (
      timestamp +
      '_' +
      hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
    );
  }

  const authParts: string[] = [];
  if (sapisid) authParts.push('SAPISIDHASH ' + (await makeHash(sapisid)));
  if (sapisid1p) authParts.push('SAPISID1PHASH ' + (await makeHash(sapisid1p)));
  if (sapisid3p) authParts.push('SAPISID3PHASH ' + (await makeHash(sapisid3p)));
  const authHeader = authParts.join(' ');

  const body = JSON.stringify([
    [calendarId, eventId],
    null,
    ['US', 0, 0],
    [3],
    null,
    2,
  ]);

  try {
    const resp = await fetch(
      'https://calendar-pa.clients6.google.com/$rpc/google.internal.calendar.v1.ConferencingService/CreateConferenceData',
      {
        method: 'POST',
        headers: {
          authorization: authHeader,
          'content-type': 'application/json+protobuf',
          'x-goog-api-key': 'AIzaSyA7GKm43l8WNxlLTjsldq9z9n80CL6KW4U',
          'x-goog-authuser': String(accountNum),
          'x-user-agent': 'grpc-web-javascript/0.1',
          origin: 'https://calendar.google.com',
          referer: 'https://calendar.google.com/',
        },
        credentials: 'include',
        body: body,
      },
    );

    if (!resp.ok) {
      console.error('createGoogleMeetLink: HTTP', resp.status);
      return null;
    }

    const data = await resp.json();

    // Extract Meet URL and code from response
    if (data && data[0] && data[0][0] && data[0][0][0] && data[0][0][0][1]) {
      const meetUrl = data[0][0][0][1] as string;
      const meetCode = data[0][0][0][2] as string;
      return {
        meetUrl,
        meetCode,
        entryPoints: data[0],
        protobufData: data[1],
      };
    }

    console.error(
      'createGoogleMeetLink: Could not parse Meet URL from response',
    );
    return null;
  } catch (e) {
    console.error('createGoogleMeetLink error:', (e as Error).message);
    return null;
  }
}

/**
 * Build event fields array for event creation.
 */
export function buildEventFields(options: {
  title: string;
  description?: string;
  location?: string;
  startTime: number;
  endTime: number;
  timezone?: string;
  ianaTimezone?: string;
  attendees?: string[];
  conference?: { entryPoints: unknown; protobufData: unknown } | null;
  recurrence?: 'daily' | 'weekly' | 'monthly' | 'yearly' | null;
  recurrenceDays?: string[] | null;
}): unknown[] {
  const {
    title,
    description = '',
    location = '',
    startTime,
    endTime,
    timezone = '2025b',
    ianaTimezone = 'America/Los_Angeles',
    attendees = [],
    conference = null,
    recurrence = null,
    recurrenceDays = null,
  } = options;

  // Field 0: Title
  const titleField = [null, [null, title]];

  // Field 1: Description
  const descField = [null, null, [null, description]];

  // Field 2: Time
  const timeField = recurrence
    ? [
        [
          null,
          [null, [startTime], ianaTimezone],
          [null, [endTime], ianaTimezone],
          null,
          null,
          timezone,
        ],
      ]
    : [[null, [null, [startTime]], [null, [endTime]], null, null, timezone]];

  // Field 3: Reminders/Location
  const field3: unknown[] = new Array(11).fill(null);
  if (location) {
    field3.push([null, null, [[[null, location]]]]);
  } else {
    field3.push([]);
  }

  // Field 4: Notification settings
  const field4 = [
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    [null, 0],
  ];

  // Field 5: More notification settings
  const field5 = [
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    [null, 0],
  ];

  // Field 6: Status/visibility
  const field6 = [null, null, null, [null, null, [1, 1]]];

  const fields: unknown[] = [
    titleField,
    descField,
    timeField,
    field3,
    field4,
    field5,
    field6,
  ];

  // Attendee fields
  if (attendees.length > 0) {
    const att0: unknown[] = new Array(8).fill(null);
    att0.push([attendees[0], attendees[0], 0]);
    fields.push(att0);
  }

  // Creator field
  const creatorField: unknown[] = new Array(31).fill(null);
  creatorField.push([3, 0]);
  fields.push(creatorField);

  // Additional attendees
  for (let i = 1; i < attendees.length; i++) {
    const att: unknown[] = new Array(8).fill(null);
    att.push([attendees[i], attendees[i], 0]);
    fields.push(att);
  }

  // Conference field
  if (conference && conference.entryPoints && conference.protobufData) {
    const confField: unknown[] = new Array(33).fill(null);
    confField.push([[], conference.entryPoints, conference.protobufData]);
    fields.push(confField);
  } else {
    const confField: unknown[] = new Array(21).fill(null);
    confField.push([]);
    fields.push(confField);
  }

  // Recurrence field
  if (recurrence) {
    const freqCodes: Record<string, number> = {
      daily: 3,
      weekly: 4,
      monthly: 5,
      yearly: 6,
    };
    const freqCode = freqCodes[recurrence];
    const recurrenceField: unknown[] = new Array(23).fill(null);

    const dayNameToNum: Record<string, number> = {
      monday: 1,
      tuesday: 2,
      wednesday: 3,
      thursday: 4,
      friday: 5,
      saturday: 6,
      sunday: 7,
      mon: 1,
      tue: 2,
      wed: 3,
      thu: 4,
      fri: 5,
      sat: 6,
      sun: 7,
      mo: 1,
      tu: 2,
      we: 3,
      th: 4,
      fr: 5,
      sa: 6,
      su: 7,
    };

    if (recurrence === 'daily') {
      recurrenceField.push([null, null, [freqCode], ianaTimezone]);
    } else if (recurrence === 'weekly') {
      let byDayEntries: unknown[];
      if (recurrenceDays && recurrenceDays.length > 0) {
        byDayEntries = recurrenceDays.map((d) => {
          const num = dayNameToNum[d.toLowerCase()];
          if (!num)
            throw new Validation(
              `Invalid recurrence day: "${d}". Use: monday, tuesday, wednesday, thursday, friday, saturday, sunday`,
            );
          return [null, num];
        });
      } else {
        const jsDay = new Date(startTime).getDay();
        byDayEntries = [[null, jsDay === 0 ? 7 : jsDay]];
      }
      recurrenceField.push([
        null,
        null,
        [freqCode, null, null, null, null, null, null, byDayEntries],
        ianaTimezone,
      ]);
    } else {
      recurrenceField.push([null, null, [freqCode], ianaTimezone]);
    }
    fields.push(recurrenceField);
  }

  // Trailing metadata field
  const trailingField: unknown[] = new Array(42).fill(null);
  trailingField.push([[], []]);
  fields.push(trailingField);

  return fields;
}

/**
 * Build event mutation for sync.sync (operation type 6 = create).
 */
export function buildEventMutation(options: {
  eventId?: string;
  title: string;
  description?: string;
  location?: string;
  startTime: number;
  endTime: number;
  timezone?: string;
  ianaTimezone?: string;
  attendees?: string[];
  calendarId: string;
  conference?: { entryPoints: unknown; protobufData: unknown } | null;
  recurrence?: 'daily' | 'weekly' | 'monthly' | 'yearly' | null;
  recurrenceDays?: string[] | null;
}): unknown[] {
  const eventId = options.eventId || generateEventId();
  const calendarId = options.calendarId;
  const eventFields = buildEventFields(options);
  const attendees = options.attendees || [];

  if (!calendarId) {
    throw new Validation('calendarId is required for event mutation');
  }

  const innerWrapperType = attendees.length > 0 ? 2 : 0;

  return [
    6,
    null,
    [
      [null, null, [eventId, null, null, eventFields, null, innerWrapperType]],
      calendarId,
    ],
    null,
    null,
    13,
  ];
}

/**
 * Build delete mutation (operation type 14).
 */
export function buildDeleteMutation(options: {
  eventId: string;
  calendarId: string;
}): unknown[] {
  const { eventId, calendarId } = options;

  if (!eventId) {
    throw new Validation('eventId is required for delete mutation');
  }
  if (!calendarId) {
    throw new Validation('calendarId is required for delete mutation');
  }

  const deleteFields = [
    [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      [],
    ],
  ];

  return [
    14,
    null,
    [[null, [eventId, null, null, deleteFields, 0]], calendarId],
    null,
    null,
    59,
  ];
}

/**
 * Build sync payload for sync.sync request.
 */
export function buildSyncPayload(options: {
  clientHeader: ClientHeader;
  syncToken: string;
  mutation: unknown;
}): string {
  const { clientHeader, syncToken, mutation } = options;

  const seqNum = 1;
  const mutSeqNum = 13;

  const payload = [
    [
      clientHeader,
      syncToken,
      null,
      null,
      [mutation],
      null,
      null,
      [],
      null,
      [[seqNum, mutSeqNum, null, [1]]],
      null,
      null,
      null,
      [null, 1, 1, 1, 1, null, 0],
    ],
    20000,
  ];

  return JSON.stringify(payload);
}

/**
 * Parse attendee response status code.
 */
export function parseResponseStatus(
  code: number,
): 'needsAction' | 'declined' | 'tentative' | 'accepted' {
  const statuses: Record<
    number,
    'needsAction' | 'declined' | 'tentative' | 'accepted'
  > = {
    0: 'needsAction',
    1: 'declined',
    2: 'tentative',
    3: 'accepted',
  };
  const status = statuses[code];
  if (!status) {
    throw new ContractDrift(`Unknown attendee response code: ${code}`);
  }
  return status;
}

/**
 * Parse event from sync.fetcheventrange response array.
 */
export function parseEventFromArray(evt: unknown[]): EventDetail {
  if (!Array.isArray(evt) || evt.length < 10) {
    throw new ContractDrift('Invalid event array structure');
  }

  const eventDetails: EventDetail = {
    id: evt[0] as string,
    title: evt[5] as string,
    description:
      evt[64] && Array.isArray(evt[64]) && evt[64][1]
        ? (evt[64][1] as string)
        : null,
    location: evt[7] as string | null,
    organizer: null,
    attendees: [],
    startTime: null,
    endTime: null,
    timezone: null,
    meetLink: evt[45] as string | null,
    conferenceData: null,
    recurrence: evt[12] as string[] | null,
    created: evt[3] ? new Date(evt[3] as number).toISOString() : null,
    updated: evt[4] ? new Date(evt[4] as number).toISOString() : null,
  };

  // Parse organizer
  if (evt[9] && Array.isArray(evt[9])) {
    eventDetails.organizer = {
      email: evt[9][0] as string,
      self: evt[9][3] === true,
    };
  }

  // Parse attendees
  if (Array.isArray(evt[20])) {
    eventDetails.attendees = (evt[20] as unknown[])
      .filter((att) => att && Array.isArray(att) && att[0])
      .map((att) => {
        const a = att as unknown[];
        return {
          email: a[0] as string,
          responseStatus: parseResponseStatus(a[5] as number),
          organizer: a[8] === true,
          self: a[9] === true,
        } as Attendee;
      });
  }

  // Parse times
  if (
    evt[35] &&
    Array.isArray(evt[35]) &&
    evt[35][1] &&
    Array.isArray(evt[35][1]) &&
    evt[35][1][0]
  ) {
    eventDetails.startTime = new Date(evt[35][1][0] as number).toISOString();
    eventDetails.timezone = evt[35][2] as string;
  }
  if (
    evt[36] &&
    Array.isArray(evt[36]) &&
    evt[36][1] &&
    Array.isArray(evt[36][1]) &&
    evt[36][1][0]
  ) {
    eventDetails.endTime = new Date(evt[36][1][0] as number).toISOString();
  }

  // Parse conference data
  if (evt[57] && Array.isArray(evt[57]) && evt[57][0]) {
    const conf = evt[57][0] as unknown[];
    eventDetails.conferenceData = {
      type: conf[0] === 3 ? 'hangoutsMeet' : 'other',
      url: conf[1] as string,
      meetingId: conf[2] as string,
    };
    if (!eventDetails.meetLink && conf[1]) {
      eventDetails.meetLink = conf[1] as string;
    }
  }

  return eventDetails;
}

/**
 * Parse event options from user input.
 */
export function parseEventOptions(input: {
  title: string;
  date: string;
  start: string;
  end?: string;
  duration?: number;
  description?: string;
  location?: string;
  attendees?: string | string[];
  timezone?: string;
}): {
  title: string;
  description: string;
  location: string;
  startTime: number;
  endTime: number;
  timezone: string;
  attendees: string[];
  calculatedEnd: string;
} {
  const {
    title,
    date,
    start,
    end,
    duration = 60,
    description = '',
    location = '',
    attendees,
    timezone = 'America/Los_Angeles',
  } = input;

  const [year, month, day] = date.split('-').map(Number);
  const [startHour, startMin] = start.split(':').map(Number);

  let endHour: number, endMin: number;
  if (end) {
    [endHour, endMin] = end.split(':').map(Number);
  } else {
    const startTotalMins = startHour * 60 + startMin;
    const endTotalMins = startTotalMins + duration;
    endHour = Math.floor(endTotalMins / 60) % 24;
    endMin = endTotalMins % 60;
  }

  const startDate = new Date(year, month - 1, day, startHour, startMin, 0, 0);
  const endDate = new Date(year, month - 1, day, endHour, endMin, 0, 0);

  let attendeeList: string[] = [];
  if (attendees) {
    if (Array.isArray(attendees)) {
      attendeeList = attendees;
    } else if (typeof attendees === 'string') {
      attendeeList = attendees
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }

  return {
    title,
    description,
    location,
    startTime: startDate.getTime(),
    endTime: endDate.getTime(),
    timezone,
    attendees: attendeeList,
    calculatedEnd: `${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`,
  };
}
