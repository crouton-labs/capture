/**
 * Google Calendar Event Read Operations
 *
 * List, search, and read calendar events.
 */

import { ContractDrift, Validation, NotFound, throwForStatus } from '@vallum/_runtime';

import type {
  EventSummary,
  ListEventsOutput,
  GetEventOutput,
  SearchEventsOutput,
  FindOverlappingEventsOutput,
  ShowAvailabilityOutput,
} from '../schemas';

import { parseEventFromArray } from '../helpers';

/**
 * Parse ListAccounts response (needed for getEvent).
 */
function parseListAccountsResponse(html: string) {
  const match = html.match(/postMessage\('([^']+)'/);
  if (!match) {
    throw new ContractDrift('Could not parse ListAccounts response');
  }

  const escapedJson = match[1];
  const json = escapedJson
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
    .replace(/\\\//g, '/');

  const data = JSON.parse(json);
  const accountsArray = data[1];

  if (!Array.isArray(accountsArray)) {
    return [];
  }

  return accountsArray.map((acc) => ({
    name: acc[2],
    email: acc[3],
    accountNumber: acc[7],
    userId: acc[10],
  }));
}

/**
 * List calendar events in a date range.
 */
export async function listEvents(input: {
  account: number;
  calendarId: string;
  startDate: string;
  endDate?: string;
  days?: number;
}): Promise<ListEventsOutput> {
  const { account, calendarId, startDate, endDate, days = 7 } = input;

  // Parse dates
  const [year, month, day] = startDate.split('-').map(Number);
  const start = new Date(year, month - 1, day, 0, 0, 0, 0);

  let end: Date;
  if (endDate) {
    const [eYear, eMonth, eDay] = endDate.split('-').map(Number);
    end = new Date(eYear, eMonth - 1, eDay, 23, 59, 59, 999);
  } else {
    end = new Date(start);
    end.setDate(end.getDate() + days);
    end.setHours(23, 59, 59, 999);
  }

  const startMs = start.getTime();
  const endMs = end.getTime();

  const payload = [[[calendarId, [[startMs, endMs]]]]];

  const resp = await fetch(`/calendar/u/${account}/minievents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'f.req=' + encodeURIComponent(JSON.stringify(payload)),
    credentials: 'include',
  });

  const text = await resp.text();
  const jsonStr = text.replace(/^\)\]\}'\n?\n?/, '');
  const rawData = JSON.parse(jsonStr);

  const events: EventSummary[] = [];

  if (rawData && rawData[0] && rawData[0][1]) {
    const calendarData = rawData[0][1];
    for (const calData of calendarData) {
      const eventList = calData[1];
      if (!Array.isArray(eventList)) continue;

      for (const evt of eventList) {
        if (Array.isArray(evt) && evt.length > 7) {
          const eventId = evt[0];
          const timeInfo = evt[1];
          const eventData = evt[7];

          if (Array.isArray(timeInfo) && Array.isArray(eventData)) {
            const startMs = timeInfo[0] as number;
            const endMs = timeInfo[1] as number;
            const startDate = new Date(startMs);
            const endDate = new Date(endMs);

            events.push({
              id: eventId as string,
              title:
                eventData[0] != null ? (eventData[0] as string) : 'Untitled',
              location: eventData[1] as string,
              startMs,
              endMs,
              startTime: startDate.toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
              }),
              endTime: endDate.toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
              }),
              date: startDate.toISOString().split('T')[0],
              isAllDay: timeInfo[2] === true,
            });
          }
        }
      }
    }
  }

  events.sort((a, b) => a.startMs - b.startMs);

  return {
    events,
    calendar: calendarId,
    startDate: start.toISOString(),
    endDate: end.toISOString(),
  };
}

/**
 * Get full event details.
 */
export async function getEvent(input: {
  account: number;
  eventId: string;
  eventDate: string;
}): Promise<GetEventOutput> {
  const { account, eventId, eventDate } = input;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
    throw new Validation(
      `eventDate must be YYYY-MM-DD. Got: ${eventDate}. Use the 'date' field from listEvents output.`,
    );
  }

  // Get calendar ID
  const accountsResp = await fetch(
    'https://accounts.google.com/ListAccounts?gpsia=1&source=ogb&mo=1&origin=https://calendar.google.com',
    { credentials: 'include' },
  );
  const accountsHtml = await accountsResp.text();
  const accounts = parseListAccountsResponse(accountsHtml);
  const currentAccount = accounts.find((a) => a.accountNumber === account);

  if (!currentAccount) {
    throw new NotFound(`Account ${account} not found`);
  }
  const calendarId = currentAccount.email;

  const baseEventId = eventId.replace(/_\d{8}T\d{6}Z$/, '');

  // Search a ±7 day window around eventDate
  const [year, month, day] = eventDate.split('-').map(Number);
  const center = new Date(Date.UTC(year, month - 1, day));
  const startDate = new Date(center);
  startDate.setUTCDate(startDate.getUTCDate() - 7);
  const endDate = new Date(center);
  endDate.setUTCDate(endDate.getUTCDate() + 7);
  const startDay = Math.floor(startDate.getTime() / (24 * 60 * 60 * 1000));
  const endDay = Math.floor(endDate.getTime() / (24 * 60 * 60 * 1000));

  // Use sync.fetcheventrange
  const fetchRangePayload = [
    [
      [calendarId],
      [null, null, startDay, endDay],
      [
        null,
        3,
        'calendar.web_20260115.11_p0',
        null,
        null,
        null,
        null,
        856745076,
        null,
        'WEB',
        'prod-04-us.web',
        1,
        null,
        null,
        null,
        0,
        null,
        '2025b',
        1,
        1,
        null,
        1,
        1,
      ],
      [null, 1, 1, 1, 1, null, 0],
    ],
  ];

  const resp = await fetch(
    `/calendar/u/${account}/sync.fetcheventrange?hl=en&cwuik=10`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'f.req=' + encodeURIComponent(JSON.stringify(fetchRangePayload)),
      credentials: 'include',
    },
  );

  if (!resp.ok) {
    throwForStatus(resp.status, 'sync.fetcheventrange failed');
  }

  const text = await resp.text();
  const jsonStr = text.replace(/^\)\]\}'\n?\n?/, '');
  const fetchRangeData = JSON.parse(jsonStr);

  if (!fetchRangeData || !fetchRangeData[0] || !fetchRangeData[0][2]) {
    throw new ContractDrift('Invalid fetcheventrange response structure');
  }

  const responseData = fetchRangeData[0][2];
  const calendarDataArray = responseData[1];

  if (!Array.isArray(calendarDataArray)) {
    throw new ContractDrift('No calendar data in fetcheventrange response');
  }

  for (const calData of calendarDataArray) {
    if (!Array.isArray(calData)) continue;

    const calId = calData[0];
    const eventList = calData[1];

    if (!Array.isArray(eventList)) continue;

    for (const evt of eventList) {
      if (!Array.isArray(evt)) continue;
      const evtId = evt[0];
      if (
        evtId === baseEventId ||
        evtId === eventId ||
        eventId.startsWith(evtId + '_')
      ) {
        const eventDetails = parseEventFromArray(evt);
        return {
          success: true,
          event: eventDetails,
          calendar: calId as string,
        };
      }
    }
  }

  throw new NotFound(`Event not found: ${eventId}`);
}

/**
 * Search calendar events by title.
 */
export async function searchEvents(input: {
  account: number;
  calendarId: string;
  query: string;
  startDate: string;
  endDate?: string;
  days?: number;
}): Promise<SearchEventsOutput> {
  const { query, ...listInput } = input;

  const { events } = await listEvents(listInput);

  const queryLower = query.toLowerCase();
  const matchingEvents = events.filter(
    (evt) => evt.title && evt.title.toLowerCase().includes(queryLower),
  );

  return {
    events: matchingEvents,
    query,
    matchCount: matchingEvents.length,
  };
}

/**
 * Show calendar availability (free/busy slots).
 */
export async function showAvailability(input: {
  account: number;
  calendarId: string;
  startDate: string;
  endDate?: string;
}): Promise<ShowAvailabilityOutput> {
  const { startDate, endDate: inputEndDate, ...listInput } = input;

  const endDate = inputEndDate || startDate;
  const { events, calendar } = await listEvents({
    ...listInput,
    startDate,
    endDate,
  });

  function formatTime(ms: number): string {
    const date = new Date(ms);
    let hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    const minutesStr = minutes < 10 ? '0' + minutes : minutes;
    return `${hours}:${minutesStr} ${ampm}`;
  }

  function formatDate(ms: number): string {
    const date = new Date(ms);
    const options: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    };
    return date.toLocaleDateString('en-US', options);
  }

  const busySlots = events
    .filter((evt) => !evt.isAllDay)
    .map((evt) => ({
      start: formatTime(evt.startMs),
      end: formatTime(evt.endMs),
      date: formatDate(evt.startMs),
      title: evt.title,
      eventId: evt.id,
    }));

  // Calculate free slots (9am-6pm by default)
  const [year, month, day] = startDate.split('-').map(Number);
  const start = new Date(year, month - 1, day, 9, 0, 0, 0);
  const [eYear, eMonth, eDay] = endDate.split('-').map(Number);
  const end = new Date(eYear, eMonth - 1, eDay, 18, 0, 0, 0);

  const freeSlots: { start: string; end: string; date: string }[] = [];
  let currentTime = start.getTime();
  const endMs = end.getTime();

  const busySlotsInternal = events
    .filter((evt) => !evt.isAllDay)
    .map((evt) => ({ startMs: evt.startMs, endMs: evt.endMs }))
    .sort((a, b) => a.startMs - b.startMs);

  for (const busy of busySlotsInternal) {
    if (busy.startMs > currentTime && busy.startMs < endMs) {
      freeSlots.push({
        start: formatTime(currentTime),
        end: formatTime(busy.startMs),
        date: formatDate(currentTime),
      });
    }
    currentTime = Math.max(currentTime, busy.endMs);
  }

  if (currentTime < endMs) {
    freeSlots.push({
      start: formatTime(currentTime),
      end: formatTime(endMs),
      date: formatDate(currentTime),
    });
  }

  return {
    calendar,
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    busySlots,
    freeSlots,
  };
}

/**
 * Find and group calendar events that overlap in time.
 */
export async function findOverlappingEvents(input: {
  account: number;
  calendarId: string;
  date?: string;
}): Promise<FindOverlappingEventsOutput> {
  const { account, calendarId, date: inputDate } = input;

  const date = inputDate || new Date().toISOString().split('T')[0];

  const { events } = await listEvents({
    account,
    calendarId,
    startDate: date,
    endDate: date,
  });

  const timedEvents = events.filter((evt) => !evt.isAllDay);

  const overlappingGroups: Array<{
    timeRange: string;
    count: number;
    events: Array<{
      id: string;
      title: string;
      startTime: string;
      endTime: string;
    }>;
  }> = [];

  const processed = new Set<string>();

  for (let i = 0; i < timedEvents.length; i++) {
    const evt1 = timedEvents[i];
    if (processed.has(evt1.id)) continue;

    const group: Array<{
      id: string;
      title: string;
      startTime: string;
      endTime: string;
    }> = [];

    for (let j = 0; j < timedEvents.length; j++) {
      if (i === j) continue;
      const evt2 = timedEvents[j];

      if (evt1.startMs < evt2.endMs && evt2.startMs < evt1.endMs) {
        if (group.length === 0) {
          group.push({
            id: evt1.id,
            title: evt1.title,
            startTime: evt1.startTime,
            endTime: evt1.endTime,
          });
        }
        group.push({
          id: evt2.id,
          title: evt2.title,
          startTime: evt2.startTime,
          endTime: evt2.endTime,
        });
      }
    }

    if (group.length > 0) {
      group.forEach((e) => processed.add(e.id));

      const groupStartMs = Math.max(
        ...group.map((e) => {
          const evt = timedEvents.find((te) => te.id === e.id);
          return evt ? evt.startMs : 0;
        }),
      );
      const groupEndMs = Math.min(
        ...group.map((e) => {
          const evt = timedEvents.find((te) => te.id === e.id);
          return evt ? evt.endMs : 0;
        }),
      );

      const startTime = new Date(groupStartMs).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
      const endTime = new Date(groupEndMs).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });

      overlappingGroups.push({
        timeRange: `${startTime} - ${endTime}`,
        count: group.length,
        events: group,
      });
    }
  }

  return {
    overlappingGroups,
    totalOverlaps: overlappingGroups.reduce((sum, g) => sum + g.count, 0),
    date,
  };
}
