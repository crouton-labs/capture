import { z } from 'zod';

export const libraryDescription =
  'Luma event platform: browse events, calendars, user profiles, and discover events by location/category (lu.ma / luma.com)';

export const libraryIcon = '/icons/libs/luma.png';
export const loginUrl = 'https://lu.ma/home';

export const libraryNotes = `
## Setup

Navigate to https://lu.ma/home in a browser. Sign in if needed. Auth uses an httpOnly session
cookie set by Luma; no token extraction required. All functions call \`api2.luma.com\` with
\`credentials: "include"\` and the browser sends the session cookie automatically.

## Workflow

1. Call \`getContext()\`: returns the signed-in user's profile and ID
2. Use returned \`userApiId\` for user-specific calls
3. All other functions work without any auth param; browser session handles it

## Key Concepts

**Event IDs**: Events have both an \`api_id\` (e.g., \`evt-KOarNFD4xU4i1iB\`) and a short \`url\` slug
(e.g., \`z81rufyb\`). Use \`resolveUrl()\` to look up events by their slug. Use \`event_api_id\`
for \`getEvent()\`.

**Calendar IDs**: Calendars have \`api_id\` like \`cal-0HILrDtzL6wnaOd\`. A calendar can host
many events. Use \`listCalendarEvents()\` to list a calendar's upcoming/past events.

**Discover**: Events are browseable by category (e.g., \`cat-tech\`, \`cat-ai\`) and location via
coordinates. Use \`discoverEvents()\` to search by category slug and lat/lng.

**User Profiles**: Accessible by username or \`api_id\`. \`getUserProfile()\` returns public info
and event counts. \`getUserEvents()\` returns events the user is hosting or attended.

**Pagination**: Paginated endpoints return \`{ entries, has_more, next_cursor }\`. Pass
\`pagination_cursor\` to get the next page.
`;

// ============================================================================
// Context
// ============================================================================

export const getContextSchema = {
  name: 'getContext',
  description:
    "Extract the signed-in user's profile from the Luma page. Call first to get userApiId for user-specific operations.",
  notes: '',
  input: z.object({}),
  output: z.object({
    userApiId: z
      .string()
      .describe('Current user API ID (e.g., usr-pExpnMK1tmwJDOP)'),
    name: z.string().describe('Full name'),
    email: z.string().describe('Email address'),
    avatarUrl: z.string().nullable(),
    timezone: z.string().describe('User timezone (e.g., America/Los_Angeles)'),
    geoCity: z.string().nullable(),
    geoCountry: z.string().nullable(),
    latitude: z
      .string()
      .nullable()
      .describe('Approximate latitude for discover queries'),
    longitude: z
      .string()
      .nullable()
      .describe('Approximate longitude for discover queries'),
  }),
};
export type GetContextInput = z.infer<typeof getContextSchema.input>;
export type GetContextOutput = z.infer<typeof getContextSchema.output>;

// ============================================================================
// Events
// ============================================================================

export const getEventSchema = {
  name: 'getEvent',
  description:
    'Get full details of an event by its API ID, including hosts, tickets, calendar, location, and guest count.',
  notes:
    'Use resolveUrl() to get the event_api_id from a short URL slug (e.g., "z81rufyb").',
  input: z.object({
    eventApiId: z.string().describe('Event API ID (e.g., evt-KOarNFD4xU4i1iB)'),
  }),
  output: z.object({
    apiId: z.string(),
    name: z.string(),
    url: z.string().describe('Short URL slug'),
    startAt: z.string().nullable().describe('ISO datetime'),
    endAt: z.string().nullable().describe('ISO datetime'),
    timezone: z.string().nullable(),
    locationType: z
      .string()
      .nullable()
      .describe('meet = in-person, zoom = virtual, etc.'),
    locationAddress: z.string().nullable().describe('Formatted address'),
    coverUrl: z.string().nullable(),
    eventType: z.string().nullable().describe('independent, recurring, etc.'),
    visibility: z.string().nullable().describe('public, private, etc.'),
    guestCount: z.number().nullable(),
    ticketCount: z.number().nullable(),
    calendarApiId: z.string().nullable(),
    calendarName: z.string().nullable(),
    hosts: z.array(
      z.object({
        apiId: z.string(),
        name: z.string(),
        username: z.string().nullable(),
        avatarUrl: z.string().nullable(),
      }),
    ),
    waitlistActive: z.boolean(),
    soldOut: z.boolean(),
    role: z
      .object({
        type: z
          .string()
          .describe('guest, host, manager, or null if not registered'),
        approvalStatus: z.string().nullable(),
      })
      .nullable(),
  }),
};
export type GetEventInput = z.infer<typeof getEventSchema.input>;
export type GetEventOutput = z.infer<typeof getEventSchema.output>;

export const resolveUrlSchema = {
  name: 'resolveUrl',
  description:
    'Resolve a Luma short URL slug to its full entity (event or calendar). Returns the entity type and full data.',
  notes: '',
  input: z.object({
    slug: z
      .string()
      .describe(
        'URL slug: the path after luma.com/ (e.g., "z81rufyb" from luma.com/z81rufyb)',
      ),
  }),
  output: z.object({
    kind: z
      .string()
      .describe('Entity type: "event", "calendar", "user", or "category"'),
    eventApiId: z
      .string()
      .nullable()
      .describe('Event API ID if kind is "event"'),
    calendarApiId: z
      .string()
      .nullable()
      .describe('Calendar API ID if kind is "calendar"'),
    name: z.string().nullable(),
  }),
};
export type ResolveUrlInput = z.infer<typeof resolveUrlSchema.input>;
export type ResolveUrlOutput = z.infer<typeof resolveUrlSchema.output>;

// ============================================================================
// Calendar
// ============================================================================

export const listCalendarEventsSchema = {
  name: 'listCalendarEvents',
  description:
    'List events on a calendar. Supports filtering by time period (future/past) and pagination. Returns event summaries with guest counts and host info.',
  notes: '',
  input: z.object({
    calendarApiId: z
      .string()
      .describe('Calendar API ID (e.g., cal-0HILrDtzL6wnaOd)'),
    period: z
      .enum(['future', 'past'])
      .optional()
      .default('future')
      .describe('Filter events by time period (default: future)'),
    paginationLimit: z
      .number()
      .optional()
      .default(20)
      .describe('Number of events to return (default: 20)'),
    paginationCursor: z
      .string()
      .optional()
      .describe('Cursor from previous response for pagination'),
  }),
  output: z.object({
    entries: z.array(
      z.object({
        apiId: z.string().describe('Calendar event entry API ID'),
        eventApiId: z.string(),
        name: z.string(),
        url: z.string().describe('Short URL slug'),
        startAt: z.string().nullable(),
        endAt: z.string().nullable(),
        timezone: z.string().nullable(),
        coverUrl: z.string().nullable(),
        locationType: z.string().nullable(),
        locationAddress: z.string().nullable(),
        guestCount: z.number().nullable(),
        hosts: z.array(
          z.object({ name: z.string(), avatarUrl: z.string().nullable() }),
        ),
        status: z.string().nullable().describe('approved, pending, etc.'),
      }),
    ),
    hasMore: z.boolean(),
    nextCursor: z.string().nullable(),
  }),
};
export type ListCalendarEventsInput = z.infer<
  typeof listCalendarEventsSchema.input
>;
export type ListCalendarEventsOutput = z.infer<
  typeof listCalendarEventsSchema.output
>;

// ============================================================================
// Discover
// ============================================================================

export const discoverEventsSchema = {
  name: 'discoverEvents',
  description:
    'Discover upcoming events by category slug and location (lat/lng). Returns paginated event listings.',
  notes: '',
  input: z.object({
    slug: z
      .string()
      .describe(
        'Category slug (e.g., "tech", "ai", "design", "music", "fitness"). Use listCategories() to get valid slugs.',
      ),
    latitude: z
      .number()
      .describe(
        'Latitude for location-based filtering. Get from getContext().',
      ),
    longitude: z
      .number()
      .describe(
        'Longitude for location-based filtering. Get from getContext().',
      ),
    paginationLimit: z
      .number()
      .optional()
      .default(10)
      .describe('Number of events to return (default: 10)'),
    paginationCursor: z
      .string()
      .optional()
      .describe('Cursor from previous response for pagination'),
  }),
  output: z.object({
    entries: z.array(
      z.object({
        eventApiId: z.string(),
        name: z.string(),
        url: z.string().describe('Short URL slug'),
        startAt: z.string().nullable(),
        endAt: z.string().nullable(),
        timezone: z.string().nullable(),
        coverUrl: z.string().nullable(),
        locationType: z.string().nullable(),
        locationAddress: z.string().nullable(),
        guestCount: z.number().nullable(),
        calendarApiId: z.string().nullable(),
        calendarName: z.string().nullable(),
        hosts: z.array(
          z.object({ name: z.string(), avatarUrl: z.string().nullable() }),
        ),
      }),
    ),
    hasMore: z.boolean(),
    nextCursor: z.string().nullable(),
  }),
};
export type DiscoverEventsInput = z.infer<typeof discoverEventsSchema.input>;
export type DiscoverEventsOutput = z.infer<typeof discoverEventsSchema.output>;

export const listCategoriesSchema = {
  name: 'listCategories',
  description:
    'List all available Luma discovery categories (e.g., Tech, AI, Design, Music).',
  notes: '',
  input: z.object({
    limit: z
      .number()
      .optional()
      .default(20)
      .describe('Max categories to return (default: 20)'),
  }),
  output: z.object({
    categories: z.array(
      z.object({
        apiId: z.string().describe('Category API ID (e.g., cat-tech, cat-ai)'),
        name: z.string(),
        slug: z
          .string()
          .describe(
            'URL slug to use with discoverEvents() (e.g., "tech", "ai")',
          ),
        description: z.string().nullable(),
        eventCount: z.number().nullable(),
        iconUrl: z.string().nullable(),
      }),
    ),
  }),
};
export type ListCategoriesInput = z.infer<typeof listCategoriesSchema.input>;
export type ListCategoriesOutput = z.infer<typeof listCategoriesSchema.output>;

// ============================================================================
// Search
// ============================================================================

export const searchSchema = {
  name: 'search',
  description:
    "Search Luma for events, calendars, and discover categories by keyword. Results are scoped to the user's attended/followed events and calendars. Use empty string to see the user's event history.",
  notes: '',
  input: z.object({
    query: z.string().describe('Search query'),
  }),
  output: z.object({
    events: z.array(
      z.object({
        eventApiId: z.string(),
        name: z.string(),
        url: z.string(),
        startAt: z.string().nullable(),
        coverUrl: z.string().nullable(),
        calendarApiId: z.string().nullable(),
      }),
    ),
    calendars: z.array(
      z.object({
        apiId: z.string(),
        name: z.string(),
        avatarUrl: z.string().nullable(),
      }),
    ),
    discoverEntities: z.array(
      z.object({
        apiId: z.string(),
        name: z.string(),
        type: z.string().describe('discover-category, etc.'),
        path: z.string().nullable(),
      }),
    ),
  }),
};
export type SearchInput = z.infer<typeof searchSchema.input>;
export type SearchOutput = z.infer<typeof searchSchema.output>;

// ============================================================================
// User Profile
// ============================================================================

export const getUserProfileSchema = {
  name: 'getUserProfile',
  description:
    "Get a user's public profile including bio, social links, and event stats (events hosted/attended).",
  notes:
    'Accepts either a username or user API ID in the username param. For the signed-in user, pass userApiId from getContext().',
  input: z.object({
    username: z
      .string()
      .describe(
        'Username or user API ID (e.g., "relycapital" or "usr-pExpnMK1tmwJDOP")',
      ),
  }),
  output: z.object({
    userApiId: z.string(),
    name: z.string(),
    username: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    bioShort: z.string().nullable(),
    isVerified: z.boolean(),
    twitterHandle: z.string().nullable(),
    instagramHandle: z.string().nullable(),
    linkedinHandle: z.string().nullable(),
    websiteUrl: z.string().nullable(),
    eventAttendedCount: z.number(),
    eventHostedCount: z.number(),
    joinedAt: z.string().nullable(),
  }),
};
export type GetUserProfileInput = z.infer<typeof getUserProfileSchema.input>;
export type GetUserProfileOutput = z.infer<typeof getUserProfileSchema.output>;

export const getUserEventsSchema = {
  name: 'getUserEvents',
  description:
    "Get a user's events: events they're hosting (upcoming), and past attended events.",
  notes:
    'Accepts either a username or user API ID in the username param. For the signed-in user, pass userApiId from getContext().',
  input: z.object({
    username: z
      .string()
      .describe(
        'Username or user API ID (e.g., "relycapital" or "usr-pExpnMK1tmwJDOP")',
      ),
  }),
  output: z.object({
    eventsHosting: z.array(
      z.object({
        eventApiId: z.string(),
        name: z.string(),
        url: z.string(),
        startAt: z.string().nullable(),
        coverUrl: z.string().nullable(),
      }),
    ),
    eventsPast: z.array(
      z.object({
        eventApiId: z.string(),
        name: z.string(),
        url: z.string(),
        startAt: z.string().nullable(),
        coverUrl: z.string().nullable(),
      }),
    ),
  }),
};
export type GetUserEventsInput = z.infer<typeof getUserEventsSchema.input>;
export type GetUserEventsOutput = z.infer<typeof getUserEventsSchema.output>;

// ============================================================================
// Notifications
// ============================================================================

export const listNotificationsSchema = {
  name: 'listNotifications',
  description: "List the signed-in user's recent Luma notifications.",
  notes: '',
  input: z.object({
    limit: z
      .number()
      .optional()
      .default(10)
      .describe('Max notifications to return (default: 10)'),
    paginationCursor: z
      .string()
      .optional()
      .describe('Cursor from previous response for pagination'),
  }),
  output: z.object({
    entries: z.array(
      z.object({
        apiId: z.string(),
        type: z
          .string()
          .describe(
            'Notification type (e.g., "event--guest-joined-waitlist", "event--registration-approved", "calendar--new-subscriber")',
          ),
        title: z.string().describe('Human-readable notification text'),
        actionAt: z
          .string()
          .nullable()
          .describe('ISO datetime when the action occurred'),
        eventApiId: z.string().nullable(),
        eventName: z.string().nullable(),
        calendarApiId: z.string().nullable(),
        calendarName: z.string().nullable(),
      }),
    ),
    hasMore: z.boolean(),
    nextCursor: z.string().nullable(),
  }),
};
export type ListNotificationsInput = z.infer<
  typeof listNotificationsSchema.input
>;
export type ListNotificationsOutput = z.infer<
  typeof listNotificationsSchema.output
>;

// ============================================================================
// Event Guests
// ============================================================================

export const getEventGuestsSchema = {
  name: 'getEventGuests',
  description:
    'Get the guest/RSVP list for an event the signed-in user hosts or manages. Returns paginated guest entries with name, email, LinkedIn, approval status, and location.',
  notes:
    'Only accessible to event hosts/managers. Returns 403 for non-hosts. Use getEvent() first to check your role.',
  input: z.object({
    eventApiId: z.string().describe('Event API ID (e.g., evt-KOarNFD4xU4i1iB)'),
    approvalStatus: z
      .enum(['approved', 'declined', 'invited', 'pending_approval', 'waitlist'])
      .optional()
      .describe(
        'Filter by approval status. Maps to UI: approved=Going, declined=Not Going, invited=Invited, pending_approval=Pending, waitlist=Waitlist.',
      ),
    paginationLimit: z
      .number()
      .optional()
      .default(50)
      .describe('Number of guests to return (default: 50)'),
    paginationCursor: z
      .string()
      .optional()
      .describe('Cursor from previous response for pagination'),
  }),
  output: z.object({
    entries: z.array(
      z.object({
        apiId: z.string().describe('Guest entry API ID'),
        name: z.string().nullable(),
        email: z.string().nullable(),
        linkedinHandle: z.string().nullable(),
        approvalStatus: z
          .string()
          .nullable()
          .describe('approved, pending, declined, or waitlisted'),
        geoCity: z.string().nullable(),
        geoCountry: z.string().nullable(),
        createdAt: z.string().nullable().describe('ISO datetime of RSVP'),
        userApiId: z.string().nullable(),
      }),
    ),
    hasMore: z.boolean(),
    nextCursor: z.string().nullable(),
  }),
};
export type GetEventGuestsInput = z.infer<typeof getEventGuestsSchema.input>;
export type GetEventGuestsOutput = z.infer<typeof getEventGuestsSchema.output>;

// ============================================================================
// Event Management (host/manager only)
// ============================================================================

export const updateEventSchema = {
  name: 'updateEvent',
  description:
    'Edit an event you host or manage. Change name, start/end times, description, location, or virtual meeting URL. Only the fields you pass are changed; all others are preserved.',
  notes:
    'Only accessible to event hosts/managers (throws on non-host). Fetches current event state first, merges your changes, then submits the full payload — so partial updates are safe.',
  input: z.object({
    eventApiId: z.string().describe('Event API ID (e.g., evt-fTG1mkSTpK25jtF)'),
    name: z.string().optional().describe('New event title.'),
    startAt: z
      .string()
      .optional()
      .describe(
        'New start time as ISO 8601 datetime with timezone offset (e.g., "2026-04-08T01:00:00.000Z").',
      ),
    endAt: z
      .string()
      .optional()
      .describe(
        'New end time as ISO 8601 datetime. If both startAt and endAt change together, pass both to avoid duration drift.',
      ),
    description: z
      .string()
      .optional()
      .describe(
        'New plain-text description. Luma renders this as a single paragraph; multi-paragraph formatting is not preserved through this function.',
      ),
    locationType: z
      .enum(['meet', 'zoom', 'offline', 'custom'])
      .optional()
      .describe(
        'Event location type. meet=Google Meet, zoom=Zoom, offline=in-person address, custom=custom URL or TBD.',
      ),
    virtualUrl: z
      .string()
      .optional()
      .describe(
        'Join URL for virtual events (Google Meet, Zoom, or custom). Only used when locationType is meet/zoom/custom.',
      ),
    timezone: z
      .string()
      .optional()
      .describe(
        'IANA timezone name for the event (e.g., "America/Los_Angeles"). If updating startAt/endAt, prefer ISO strings with offset and leave this alone.',
      ),
  }),
  output: z.object({
    eventApiId: z.string(),
    name: z.string(),
    startAt: z.string().nullable(),
    endAt: z.string().nullable(),
    locationType: z.string().nullable(),
    timezone: z.string().nullable(),
  }),
};
export type UpdateEventInput = z.infer<typeof updateEventSchema.input>;
export type UpdateEventOutput = z.infer<typeof updateEventSchema.output>;

export const cancelEventSchema = {
  name: 'cancelEvent',
  description:
    'Cancel an event you host or manage. Irreversible — Luma does not provide an un-cancel endpoint. Guests are notified by Luma.',
  notes:
    'Only accessible to event hosts/managers. After cancellation the event still exists (discoverable via getEvent) but is marked canceled and no longer listed on /home. There is no separate "delete event" endpoint — cancel is the most destructive operation Luma exposes.',
  input: z.object({
    eventApiId: z.string().describe('Event API ID (e.g., evt-fTG1mkSTpK25jtF)'),
  }),
  output: z.object({
    eventApiId: z.string(),
    canceled: z.literal(true),
  }),
};
export type CancelEventInput = z.infer<typeof cancelEventSchema.input>;
export type CancelEventOutput = z.infer<typeof cancelEventSchema.output>;

// ============================================================================
// Guest Management (host/manager only)
// ============================================================================

export const inviteGuestsSchema = {
  name: 'inviteGuests',
  description:
    'Invite people to an event by email. Luma sends each recipient an invitation email with the event link. Used for the "Invite Guests" flow on the event manage page.',
  notes:
    'Only accessible to event hosts/managers. Each email is added to the guest list with approval_status="invited". For application-based events, invitees still need to apply after receiving the email. Use updateGuestStatuses() to later approve/decline their applications.',
  input: z.object({
    eventApiId: z.string().describe('Event API ID (e.g., evt-fTG1mkSTpK25jtF)'),
    emails: z
      .array(z.string())
      .min(1)
      .describe('Email addresses to invite. Each gets an invitation email.'),
    message: z
      .string()
      .optional()
      .default('')
      .describe('Custom message included in the invitation email.'),
  }),
  output: z.object({
    taskId: z
      .string()
      .describe(
        'Async task ID. Invites are sent in the background; poll via getEventGuests() to see new "invited" entries.',
      ),
    invitedCount: z
      .number()
      .describe('Number of emails submitted for invitation.'),
  }),
};
export type InviteGuestsInput = z.infer<typeof inviteGuestsSchema.input>;
export type InviteGuestsOutput = z.infer<typeof inviteGuestsSchema.output>;

export const updateGuestStatusesSchema = {
  name: 'updateGuestStatuses',
  description:
    'Change the approval status of one or more guests (approve applications, decline, waitlist, reset to invited, etc.). Handles accept/reject for application-based events and bulk status changes.',
  notes:
    'Only accessible to event hosts/managers. Use getEventGuests() to obtain guest apiIds first. The approval_status values map to the UI labels as follows: approved=Going, declined=Not Going, invited=Invited, pending_approval=Pending, waitlist=Waitlist. This endpoint is the single source for all application accept/reject flows. To remove/disinvite a guest, set status to "declined" — Luma has no hard-delete endpoint for individual guests.',
  input: z.object({
    eventApiId: z.string().describe('Event API ID (e.g., evt-fTG1mkSTpK25jtF)'),
    guestApiIds: z
      .array(z.string())
      .min(1)
      .describe(
        'Guest entry apiIds (gst-...) from getEventGuests(). Bulk updates supported — pass multiple to change many guests at once.',
      ),
    approvalStatus: z
      .enum(['approved', 'declined', 'invited', 'pending_approval', 'waitlist'])
      .describe(
        'New status. approved=Going (accept application), declined=Not Going (reject), invited=reset to invited, pending_approval=Pending review, waitlist=Waitlist.',
      ),
    suppressEmail: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'If true, Luma does not send a status-change email to the guests. Default false (guests are notified).',
      ),
    customMessage: z
      .string()
      .optional()
      .default('')
      .describe(
        'Optional message included in the status-change notification email. Ignored if suppressEmail is true.',
      ),
    eventTicketTypeApiId: z
      .string()
      .nullable()
      .optional()
      .describe(
        'Ticket type to assign when approving (only relevant for ticketed events with multiple ticket types). Pass null/omit for default.',
      ),
  }),
  output: z.object({
    taskId: z
      .string()
      .describe(
        'Async task ID. Status change is processed in the background; poll via getEventGuests() to confirm new status.',
      ),
    updatedCount: z
      .number()
      .describe('Number of guests submitted for status update.'),
  }),
};
export type UpdateGuestStatusesInput = z.infer<
  typeof updateGuestStatusesSchema.input
>;
export type UpdateGuestStatusesOutput = z.infer<
  typeof updateGuestStatusesSchema.output
>;

// ============================================================================
// allSchemas
// ============================================================================

export const allSchemas = [
  getContextSchema,
  getEventSchema,
  resolveUrlSchema,
  listCalendarEventsSchema,
  discoverEventsSchema,
  listCategoriesSchema,
  searchSchema,
  getUserProfileSchema,
  getUserEventsSchema,
  listNotificationsSchema,
  getEventGuestsSchema,
  updateEventSchema,
  cancelEventSchema,
  inviteGuestsSchema,
  updateGuestStatusesSchema,
];
