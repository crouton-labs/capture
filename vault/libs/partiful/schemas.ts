import { z } from 'zod';

export const libraryDescription =
  'Partiful event planning app: browse events, manage guests, discover mutuals, and read comments via Partiful API';

export const libraryIcon = '/icons/libs/partiful.ico';
export const loginUrl = 'https://partiful.com/events';

export const libraryNotes = `
## Workflow

1. Call \`getContext()\`: extracts Firebase Bearer token and userId from IDB
2. Pass the returned \`token\` and \`userId\` to all subsequent calls

## Key Concepts

**Event IDs**: String IDs like \`FvXISpRl3uJBx1nhHhVG\`. Appear in event URLs \`/e/{eventId}\`.

**User IDs**: String IDs like \`YmfWBhViliSr0egMT58aG80Q5CJ2\`. Returned in event ownerIds, guest lists, etc.

**Contacts vs Mutuals**: Contacts are all people you share events with (ordered by shared event count). Mutuals is a subset (people you follow who are also on Partiful).

**Pagination**: Endpoints that support paging use \`{ cursor, maxResults }\`. Pass \`cursor: null\` to start from the beginning; use the returned \`nextCursor\` for subsequent pages.

**Auth token expiry**: Firebase tokens expire after ~1 hour. Call \`getContext()\` again if you get 401 errors.
`;

// ============================================================================
// Context
// ============================================================================

export const getContextSchema = {
  name: 'getContext',
  description:
    'Extract Firebase auth token and userId from the Partiful browser session; call FIRST before any other function.',
  notes: '',
  input: z.object({}),
  output: z.object({
    token: z.string().describe('Firebase Bearer token for API calls'),
    userId: z.string().describe('Current user ID (Firebase UID)'),
    displayName: z.string().describe('Display name of the current user'),
  }),
};
export type GetContextInput = z.infer<typeof getContextSchema.input>;
export type GetContextOutput = z.infer<typeof getContextSchema.output>;

// ============================================================================
// Events
// ============================================================================

const PartifulEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string().describe('PUBLISHED, DRAFT, CANCELLED, etc.'),
  startDate: z.string().nullable().describe('ISO 8601 datetime'),
  endDate: z.string().nullable().describe('ISO 8601 datetime'),
  timezone: z.string().nullable(),
  description: z.string().nullable(),
  ownerIds: z.array(z.string()).describe('User IDs of hosts/co-hosts'),
  imageUrl: z
    .string()
    .nullable()
    .describe('Optimized imgix URL for event image'),
  respondedGuestCount: z.number().nullable(),
  approvedGuestCount: z.number().nullable(),
  goingGuestCount: z.number().nullable(),
  waitlistGuestCount: z.number().nullable(),
  guestAction: z.string().nullable().describe('RSVP, APPLY, etc.'),
  showGuestCount: z.boolean().nullable(),
});

export const listMyEventsSchema = {
  name: 'listMyEvents',
  description:
    "Get the current user's upcoming events they are hosting or attending",
  notes: '',
  input: z.object({
    token: z.string().describe('Bearer token from getContext'),
    userId: z.string().describe('userId from getContext'),
  }),
  output: z.object({
    events: z.array(PartifulEventSchema),
  }),
};
export type ListMyEventsInput = z.infer<typeof listMyEventsSchema.input>;
export type ListMyEventsOutput = z.infer<typeof listMyEventsSchema.output>;

export const getEventsByIdsSchema = {
  name: 'getEventsByIds',
  description: 'Get full event details for one or more event IDs in a batch',
  notes: '',
  input: z.object({
    token: z.string().describe('Bearer token from getContext'),
    userId: z.string().describe('userId from getContext'),
    eventIds: z.array(z.string()).describe('List of event IDs to fetch'),
  }),
  output: z.object({
    events: z.array(PartifulEventSchema),
  }),
};
export type GetEventsByIdsInput = z.infer<typeof getEventsByIdsSchema.input>;
export type GetEventsByIdsOutput = z.infer<typeof getEventsByIdsSchema.output>;

export const getMySavedEventsSchema = {
  name: 'getMySavedEvents',
  description: 'Get events the current user has saved/bookmarked',
  notes: '',
  input: z.object({
    token: z.string().describe('Bearer token from getContext'),
    userId: z.string().describe('userId from getContext'),
  }),
  output: z.object({
    events: z.array(PartifulEventSchema),
  }),
};
export type GetMySavedEventsInput = z.infer<
  typeof getMySavedEventsSchema.input
>;
export type GetMySavedEventsOutput = z.infer<
  typeof getMySavedEventsSchema.output
>;

export const getMyFollowedEventsSchema = {
  name: 'getMyFollowedEvents',
  description: 'Get events the current user is following for updates',
  notes: '',
  input: z.object({
    token: z.string().describe('Bearer token from getContext'),
    userId: z.string().describe('userId from getContext'),
  }),
  output: z.object({
    events: z.array(PartifulEventSchema),
  }),
};
export type GetMyFollowedEventsInput = z.infer<
  typeof getMyFollowedEventsSchema.input
>;
export type GetMyFollowedEventsOutput = z.infer<
  typeof getMyFollowedEventsSchema.output
>;

export const getEventCommentsSchema = {
  name: 'getEventComments',
  description: 'Get the comment/hype thread for an event',
  notes: '',
  input: z.object({
    token: z.string().describe('Bearer token from getContext'),
    userId: z.string().nullable().describe('userId from getContext, or null'),
    eventId: z.string().describe('Event ID'),
  }),
  output: z.object({
    comments: z.array(
      z.object({
        id: z.string(),
        message: z.string(),
        createdAt: z.string(),
        authorId: z.string().nullable(),
        authorName: z.string().nullable(),
        reactionCount: z.number(),
      }),
    ),
  }),
};
export type GetEventCommentsInput = z.infer<
  typeof getEventCommentsSchema.input
>;
export type GetEventCommentsOutput = z.infer<
  typeof getEventCommentsSchema.output
>;

export const getEventMediaSchema = {
  name: 'getEventMedia',
  description: 'Get photos and media uploaded for an event',
  notes: '',
  input: z.object({
    token: z.string().describe('Bearer token from getContext'),
    userId: z.string().nullable().describe('userId from getContext, or null'),
    eventId: z.string().describe('Event ID'),
  }),
  output: z.object({
    media: z.array(
      z.object({
        id: z.string().optional(),
        type: z.string().describe('image, video, etc.'),
        url: z.string().nullable(),
        uploadedAt: z.string().nullable(),
        uploaderId: z.string().nullable(),
      }),
    ),
  }),
};
export type GetEventMediaInput = z.infer<typeof getEventMediaSchema.input>;
export type GetEventMediaOutput = z.infer<typeof getEventMediaSchema.output>;

// ============================================================================
// People
// ============================================================================

const PartifulUserSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  photoUrl: z.string().nullable().describe('Profile photo URL'),
  createdAt: z.string().nullable().describe('ISO 8601 account creation date'),
  birthdayMonth: z.number().nullable(),
  instagram: z.string().nullable().describe('Instagram handle if visible'),
  onPartiful: z.boolean().nullable(),
});

export const getUsersSchema = {
  name: 'getUsers',
  description: 'Get profile information for one or more users by their IDs',
  notes: '',
  input: z.object({
    token: z.string().describe('Bearer token from getContext'),
    userId: z.string().describe('userId from getContext'),
    ids: z.array(z.string()).describe('User IDs to fetch'),
    includePartyStats: z
      .boolean()
      .optional()
      .default(false)
      .describe('Whether to include party statistics'),
  }),
  output: z.object({
    users: z.array(PartifulUserSchema),
  }),
};
export type GetUsersInput = z.infer<typeof getUsersSchema.input>;
export type GetUsersOutput = z.infer<typeof getUsersSchema.output>;

export const getMutualsSchema = {
  name: 'getMutuals',
  description:
    'Get the list of mutual connections: people you share events with on Partiful',
  notes: '',
  input: z.object({
    token: z.string().describe('Bearer token from getContext'),
    userId: z.string().describe('userId from getContext'),
    maxResults: z
      .number()
      .optional()
      .default(100)
      .describe('Max results to return (default 100)'),
    cursor: z
      .string()
      .nullable()
      .optional()
      .default(null)
      .describe('Pagination cursor, null for first page'),
  }),
  output: z.object({
    mutuals: z.array(
      z.object({
        userId: z.string(),
        name: z.string(),
        sharedEventCount: z.number(),
        isPastGuest: z.boolean().nullable(),
        sharedEvent: z
          .object({
            id: z.string(),
            title: z.string(),
            startDate: z.string(),
          })
          .nullable()
          .describe('Most recent shared event'),
      }),
    ),
    nextCursor: z
      .string()
      .nullable()
      .describe('Cursor for next page, null if no more results'),
  }),
};
export type GetMutualsInput = z.infer<typeof getMutualsSchema.input>;
export type GetMutualsOutput = z.infer<typeof getMutualsSchema.output>;

export const getContactsSchema = {
  name: 'getContacts',
  description:
    'Get all contacts: everyone you share events with on Partiful, ordered by shared event count',
  notes: '',
  input: z.object({
    token: z.string().describe('Bearer token from getContext'),
    userId: z.string().describe('userId from getContext'),
    maxResults: z
      .number()
      .optional()
      .default(1000)
      .describe('Max results per page (default 1000)'),
    cursor: z
      .string()
      .nullable()
      .optional()
      .default(null)
      .describe('Pagination cursor, null for first page'),
  }),
  output: z.object({
    contacts: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        sharedEventCount: z.number(),
        isPastGuest: z.boolean().nullable(),
        sharedEvent: z
          .object({
            id: z.string(),
            title: z.string(),
            startDate: z.string(),
          })
          .nullable()
          .describe('Most recent shared event'),
      }),
    ),
    nextCursor: z
      .string()
      .nullable()
      .describe('Cursor for next page, null if no more results'),
  }),
};
export type GetContactsInput = z.infer<typeof getContactsSchema.input>;
export type GetContactsOutput = z.infer<typeof getContactsSchema.output>;

// ============================================================================
// allSchemas
// ============================================================================

export const allSchemas = [
  getContextSchema,
  listMyEventsSchema,
  getEventsByIdsSchema,
  getMySavedEventsSchema,
  getMyFollowedEventsSchema,
  getEventCommentsSchema,
  getEventMediaSchema,
  getUsersSchema,
  getMutualsSchema,
  getContactsSchema,
];
