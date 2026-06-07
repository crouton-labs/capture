import { z } from 'zod';

export const libraryDescription =
  'Calendly scheduling operations via internal REST and GraphQL APIs';

export const libraryIcon = '/icons/libs/calendly.ico';
export const loginUrl = 'https://calendly.com/login';

export const libraryNotes = `
## Workflow

1. Navigate to \`https://calendly.com\`
2. Call \`getContext()\` to get \`{ csrf, userId, userUuid, email }\`
3. Call Calendly functions with \`csrf\`

## Key Concepts

- **Event Types**: Scheduling page templates (e.g. "30-min call"). Each has a numeric \`id\` and a UUID. Active status controls booking availability.
- **Meetings**: Scheduled events booked by invitees. Fetched via GraphQL with cursor-based pagination.
- **CSRF**: Extracted from \`<meta name="csrf-token">\` on the page DOM.
- **User ID**: Numeric ID returned from \`/api/user\`. Required for \`getEventType\`.
- **Pagination**: Meetings use cursor-based pagination. Pass \`after\` cursor to get the next page.
- **Time filters**: \`listMeetings\` accepts \`period: "upcoming"| "past"\` to control which meetings are returned.
`;

// ============================================================================
// Shared Params
// ============================================================================

export const CsrfParam = z
  .string()
  .describe('CSRF token from meta[name=csrf-token] on the page');

// ============================================================================
// Context
// ============================================================================

export const getContextSchema = {
  name: 'getContext',
  description:
    'Extract CSRF token, user ID, user UUID, and email from the current Calendly page',
  notes:
    'Call FIRST before any other Calendly operations. Must be on calendly.com.',
  input: z.object({
    timeoutMs: z
      .number()
      .optional()
      .default(10000)
      .describe('Max wait time in milliseconds (default: 10000)'),
  }),
  output: z.object({
    csrf: z.string().describe('CSRF token for API requests'),
    userId: z.number().describe('Numeric current user ID'),
    userUuid: z.string().describe('UUID of the current user'),
    email: z.string().describe('Current user email address'),
  }),
};

// ============================================================================
// User
// ============================================================================

export const getUserSchema = {
  name: 'getUser',
  description: 'Get current user profile information',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
  }),
  output: z.object({
    id: z.number().describe('Numeric user ID'),
    email: z.string().describe('User email address'),
    name: z.string().optional().describe('User full name'),
    booking_url: z.string().optional().describe('User public booking URL'),
    timezone: z.string().optional().describe('User timezone'),
    created_at: z.string().optional().describe('Account creation timestamp'),
    events_count: z.number().optional().describe('Total number of event types'),
  }),
};

// ============================================================================
// Organization
// ============================================================================

export const OrganizationOwnerSchema = z.object({
  id: z.number().describe('Owner user ID'),
  email: z.string().optional().describe('Owner email'),
  name: z.string().optional().describe('Owner full name'),
});

export const getOrganizationSchema = {
  name: 'getOrganization',
  description: 'Get organization details for the current user',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
  }),
  output: z.object({
    id: z.number().describe('Organization ID'),
    name: z
      .string()
      .nullable()
      .describe('Organization name (null for individual accounts)'),
    tier: z.string().optional().describe('Subscription tier'),
    stage: z.string().optional().describe('Org stage'),
    kind: z.string().optional().describe('Organization kind'),
    uri: z.string().optional().describe('Organization URI'),
    owner: OrganizationOwnerSchema.optional().describe('Organization owner'),
  }),
};

// ============================================================================
// Event Types
// ============================================================================

export const LocationConfigurationSchema = z.object({
  id: z.number().optional().describe('Location configuration ID'),
  kind: z
    .string()
    .optional()
    .describe(
      'Location type (google_conference, physical, custom, outbound_call, inbound_call, ask_invitee, zoom, microsoft_teams, webex)',
    ),
  position: z.number().optional().describe('Display order position'),
  location: z.string().nullable().optional().describe('Location value or URL'),
  phone_number: z
    .string()
    .nullable()
    .optional()
    .describe('Phone number for phone call locations'),
  additional_info: z
    .string()
    .nullable()
    .optional()
    .describe('Additional location info'),
  hide_location: z
    .boolean()
    .optional()
    .describe('Whether to hide location from invitee'),
});

export const EventTypeSchema = z.object({
  id: z.number().describe('Numeric event type ID'),
  uuid: z.string().optional().describe('Event type UUID'),
  name: z.string().describe('Event type name'),
  slug: z.string().optional().describe('URL slug'),
  active: z.boolean().optional().describe('Whether booking is enabled'),
  kind: z.string().optional().describe('Event kind (solo, group, etc.)'),
  kind_name: z.string().optional().describe('Human-readable kind name'),
  duration: z
    .string()
    .optional()
    .describe('Formatted duration string (e.g. "30 mins", "1 hr", "15 mins")'),
  duration_minutes: z
    .number()
    .optional()
    .describe('Duration in minutes as a number'),
  booking_url: z.string().optional().describe('Public booking URL'),
  booking_path: z.string().optional().describe('Booking path slug'),
  color: z.string().optional().describe('Display color hex code'),
  description: z
    .string()
    .nullable()
    .optional()
    .describe('Event type description'),
  location_type: z.string().optional().describe('Primary location type'),
  location_configurations: z
    .array(LocationConfigurationSchema)
    .optional()
    .describe('All configured locations'),
  invitees_limit: z
    .number()
    .optional()
    .describe('Max invitees for group events'),
  public: z.boolean().optional().describe('Whether publicly listed'),
  position: z.number().optional().describe('Display order position'),
});

export const listEventTypesSchema = {
  name: 'listEventTypes',
  description:
    'List all event types for the current user. Returns the complete set by combining multiple API sources; the list API alone is capped at ~5.',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
  }),
  output: z.object({
    results: z
      .array(
        z.object({
          id: z.number().describe('Profile/user ID'),
          name: z.string().describe('User or team name'),
          type: z.string().describe('Profile type (e.g. "User")'),
          event_types: z
            .array(EventTypeSchema)
            .describe('Event types in this profile'),
        }),
      )
      .describe('Profile groups each containing their event types'),
  }),
};

export const EventTypeDetailSchema = z.object({
  id: z.number().describe('Numeric event type ID'),
  uuid: z.string().optional().describe('Event type UUID'),
  name: z.string().describe('Event type name'),
  slug: z.string().optional().describe('URL slug'),
  active: z.boolean().optional().describe('Whether booking is enabled'),
  kind: z.string().optional().describe('Event kind'),
  kind_name: z.string().optional().describe('Human-readable kind name'),
  duration: z.number().optional().describe('Duration in minutes'),
  min_booking_time: z
    .number()
    .optional()
    .describe('Minimum advance booking time in seconds (e.g. 14400 = 4 hours)'),
  max_booking_time: z
    .number()
    .optional()
    .describe('Maximum advance booking time in seconds (e.g. 86400 = 1 day)'),
  before_buffer_time: z
    .number()
    .optional()
    .describe('Buffer time before event in minutes'),
  after_buffer_time: z
    .number()
    .optional()
    .describe('Buffer time after event in minutes'),
  booking_url: z.string().optional().describe('Public booking URL'),
  guests_allowed: z
    .boolean()
    .optional()
    .describe('Whether guests can be added'),
  cancellation_allowed: z
    .boolean()
    .optional()
    .describe('Whether invitees can cancel'),
  period_type: z
    .string()
    .optional()
    .describe('Availability period type (rolling, fixed, etc.)'),
  pooling_type: z.string().optional().describe('Pooling type for round-robin'),
  color: z.string().optional().describe('Display color hex code'),
  description: z
    .string()
    .nullable()
    .optional()
    .describe('Event type description'),
  location_configurations: z
    .array(LocationConfigurationSchema)
    .optional()
    .describe('All configured locations'),
  invitees_limit: z
    .number()
    .optional()
    .describe('Max invitees for group events'),
  custom_fields: z
    .array(
      z.object({
        id: z.number().optional().describe('Custom field ID'),
        name: z.string().optional().describe('Question text shown to invitee'),
        format: z
          .string()
          .optional()
          .describe('Field format: text, phone, textarea, etc.'),
        enabled: z
          .boolean()
          .optional()
          .describe('Whether this field is active'),
        required: z
          .boolean()
          .optional()
          .describe('Whether invitee must answer'),
        position: z.number().optional().describe('Display order'),
        answer_choices: z
          .array(z.string())
          .nullable()
          .optional()
          .describe('Choices for dropdown/radio fields'),
        include_other: z
          .boolean()
          .optional()
          .describe('Whether to include an "Other" option'),
      }),
    )
    .optional()
    .describe('Custom intake questions configured on this event type'),
  next_availability: z
    .string()
    .nullable()
    .optional()
    .describe('ISO timestamp of next available slot'),
});

export const getEventTypeSchema = {
  name: 'getEventType',
  description: 'Get detailed information about a single event type',
  notes:
    'Requires the numeric userId from getContext() and numeric eventTypeId from listEventTypes().',
  input: z.object({
    csrf: CsrfParam,
    userId: z.number().describe('Numeric user ID from getContext()'),
    eventTypeId: z
      .number()
      .describe('Numeric event type ID from listEventTypes()'),
  }),
  output: EventTypeDetailSchema,
};

export const LocationInputSchema = z.object({
  kind: z
    .string()
    .describe(
      'Location type. Valid values: physical (in-person address), google_conference (Google Meet), outbound_call (phone call), custom (freeform text), ask_invitee (let invitee choose), inbound_call (requires phone_number). Note: zoom, microsoft_teams, webex only work if the integration is configured on the account.',
    ),
  location: z
    .string()
    .optional()
    .describe(
      'Address or location text. Required for physical and custom kinds. Must be omitted for google_conference, outbound_call, ask_invitee.',
    ),
  phone_number: z
    .string()
    .optional()
    .describe('Phone number. Required for inbound_call kind.'),
  position: z
    .number()
    .optional()
    .describe('Display order (0-indexed). Defaults to array index if omitted.'),
});

export const createEventTypeSchema = {
  name: 'createEventType',
  description: 'Create a new event type for the current user',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    userId: z.number().describe('Numeric user ID from getContext()'),
    name: z.string().describe('Event type name'),
    duration: z
      .number()
      .optional()
      .default(30)
      .describe('Duration in minutes (default: 30)'),
    color: z
      .string()
      .optional()
      .describe('Display color hex code (e.g. "#8247f5")'),
    description: z.string().optional().describe('Event type description'),
    locations: z
      .array(LocationInputSchema)
      .optional()
      .describe('Location options for the event type. Omit for no locations.'),
  }),
  output: EventTypeDetailSchema,
};

export const updateEventTypeSchema = {
  name: 'updateEventType',
  description: 'Update fields on an existing event type',
  notes:
    'Only send fields you want to change. Slug does NOT change when name changes. Sending locations replaces all existing locations.',
  input: z.object({
    csrf: CsrfParam,
    userId: z.number().describe('Numeric user ID from getContext()'),
    eventTypeId: z
      .number()
      .describe('Numeric event type ID from listEventTypes()'),
    name: z.string().optional().describe('New event type name'),
    description: z.string().optional().describe('New description'),
    duration: z.number().optional().describe('New duration in minutes'),
    color: z.string().optional().describe('New display color hex code'),
    locations: z
      .array(LocationInputSchema)
      .optional()
      .describe(
        'New location options. Replaces all existing locations. Send empty array to clear.',
      ),
  }),
  output: EventTypeDetailSchema,
};

export const toggleEventTypeSchema = {
  name: 'toggleEventType',
  description:
    'Activate or deactivate an event type to control booking availability',
  notes:
    'Uses separate /activate and /deactivate endpoints; setting active in a PUT body does NOT work.',
  input: z.object({
    csrf: CsrfParam,
    userId: z.number().describe('Numeric user ID from getContext()'),
    eventTypeId: z
      .number()
      .describe('Numeric event type ID from listEventTypes()'),
    active: z
      .boolean()
      .describe('true to activate (enable booking), false to deactivate'),
  }),
  output: EventTypeDetailSchema,
};

export const cloneEventTypeSchema = {
  name: 'cloneEventType',
  description: 'Clone an existing event type, creating a copy with a new ID',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    userId: z.number().describe('Numeric user ID from getContext()'),
    eventTypeId: z.number().describe('Numeric event type ID to clone'),
  }),
  output: EventTypeDetailSchema,
};

export const deleteEventTypeSchema = {
  name: 'deleteEventType',
  description: 'Delete an event type permanently',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    userId: z.number().describe('Numeric user ID from getContext()'),
    eventTypeId: z.number().describe('Numeric event type ID to delete'),
  }),
  output: z.object({
    success: z.boolean().describe('true if deletion succeeded'),
  }),
};

// ============================================================================
// Meetings
// ============================================================================

export const AttendeeSchema = z.object({
  kind: z
    .string()
    .optional()
    .describe('Attendee kind: INVITEE, HOST, or COHOST'),
  name: z.string().optional().describe('Attendee full name'),
  email: z.string().optional().describe('Attendee email address'),
  timezone: z.string().optional().describe('Attendee timezone'),
  uuid: z.string().optional().describe('Attendee UUID'),
  cancelled: z.boolean().optional().describe('Whether this attendee cancelled'),
  rsvp: z.string().optional().describe('RSVP status (INVITEE attendees only)'),
});

export const MeetingSchema = z.object({
  uuid: z.string().describe('Meeting UUID'),
  name: z.string().optional().describe('Meeting name/title'),
  status: z.string().optional().describe('Meeting status'),
  cancelled: z.boolean().optional().describe('Whether meeting was cancelled'),
  kind: z.string().optional().describe('Meeting kind (CALENDLY, GOOGLE, etc.)'),
  start_time: z.number().optional().describe('Start time as Unix milliseconds'),
  end_time: z.number().optional().describe('End time as Unix milliseconds'),
  location: z.string().optional().describe('Meeting location'),
  location_kind: z.string().optional().describe('Location type'),
  owner_user_uuid: z.string().optional().describe('UUID of meeting owner'),
  attendees: z
    .array(AttendeeSchema)
    .optional()
    .describe('All meeting attendees'),
  invitees_limit: z.number().optional().describe('Max invitees (group events)'),
  invitees_count: z.number().optional().describe('Current invitee count'),
});

export const PageInfoSchema = z.object({
  hasNextPage: z.boolean().describe('Whether more pages exist'),
  hasPreviousPage: z.boolean().describe('Whether previous pages exist'),
  startCursor: z
    .string()
    .nullable()
    .optional()
    .describe('Cursor for start of this page'),
  endCursor: z
    .string()
    .nullable()
    .optional()
    .describe('Cursor to pass as `after` for next page'),
});

export const listMeetingsSchema = {
  name: 'listMeetings',
  description:
    'List scheduled meetings (upcoming or past) with cursor-based pagination',
  notes:
    'Pass `after` cursor from previous response `pageInfo.endCursor` to paginate. Use `period: "upcoming"` for future meetings, `period: "past"` for historical.',
  input: z.object({
    csrf: CsrfParam,
    period: z
      .enum(['upcoming', 'past'])
      .optional()
      .default('upcoming')
      .describe(
        'Whether to fetch upcoming or past meetings (default: upcoming)',
      ),
    first: z
      .number()
      .optional()
      .default(30)
      .describe('Number of meetings to return per page (default: 30)'),
    after: z
      .string()
      .optional()
      .describe('Pagination cursor from previous response pageInfo.endCursor'),
  }),
  output: z.object({
    meetings: z.array(MeetingSchema).describe('List of meetings'),
    total: z.number().describe('Total meeting count matching the filter'),
    pageInfo: PageInfoSchema.describe('Pagination cursors and flags'),
  }),
};

// ============================================================================
// All Schemas Export
// ============================================================================

export const allSchemas = [
  getContextSchema,
  getUserSchema,
  getOrganizationSchema,
  listEventTypesSchema,
  getEventTypeSchema,
  createEventTypeSchema,
  updateEventTypeSchema,
  toggleEventTypeSchema,
  cloneEventTypeSchema,
  deleteEventTypeSchema,
  listMeetingsSchema,
];

// ============================================================================
// Inferred Types
// ============================================================================

// Entity types
export type OrganizationOwner = z.infer<typeof OrganizationOwnerSchema>;
export type LocationConfiguration = z.infer<typeof LocationConfigurationSchema>;
export type EventType = z.infer<typeof EventTypeSchema>;
export type EventTypeDetail = z.infer<typeof EventTypeDetailSchema>;
export type Attendee = z.infer<typeof AttendeeSchema>;
export type Meeting = z.infer<typeof MeetingSchema>;
export type PageInfo = z.infer<typeof PageInfoSchema>;

// Output types
export type GetContextOutput = z.infer<typeof getContextSchema.output>;
export type GetUserOutput = z.infer<typeof getUserSchema.output>;
export type GetOrganizationOutput = z.infer<
  typeof getOrganizationSchema.output
>;
export type ListEventTypesOutput = z.infer<typeof listEventTypesSchema.output>;
export type GetEventTypeOutput = z.infer<typeof getEventTypeSchema.output>;
export type CreateEventTypeOutput = z.infer<
  typeof createEventTypeSchema.output
>;
export type UpdateEventTypeOutput = z.infer<
  typeof updateEventTypeSchema.output
>;
export type ToggleEventTypeOutput = z.infer<
  typeof toggleEventTypeSchema.output
>;
export type CloneEventTypeOutput = z.infer<typeof cloneEventTypeSchema.output>;
export type DeleteEventTypeOutput = z.infer<
  typeof deleteEventTypeSchema.output
>;
export type ListMeetingsOutput = z.infer<typeof listMeetingsSchema.output>;
