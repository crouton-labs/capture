import { Unauthenticated, ContractDrift, UpstreamError, throwForStatus } from '@vallum/_runtime';

// Types from schemas - single source of truth
export type {
  OrganizationOwner,
  LocationConfiguration,
  EventType,
  EventTypeDetail,
  Attendee,
  Meeting,
  PageInfo,
  GetContextOutput,
  GetUserOutput,
  GetOrganizationOutput,
  ListEventTypesOutput,
  GetEventTypeOutput,
  CreateEventTypeOutput,
  UpdateEventTypeOutput,
  ToggleEventTypeOutput,
  CloneEventTypeOutput,
  DeleteEventTypeOutput,
  ListMeetingsOutput,
} from './schemas';

import type {
  EventType,
  GetUserOutput,
  GetOrganizationOutput,
  ListEventTypesOutput,
  GetEventTypeOutput,
  DeleteEventTypeOutput,
  ListMeetingsOutput,
} from './schemas';

// ============================================================================
// Context Acquisition
// ============================================================================

export interface CalendlyContext {
  csrf: string;
  userId: number;
  userUuid: string;
  email: string;
}

/**
 * Extract CSRF token, user ID, user UUID, and email from the current Calendly page.
 * Call this FIRST before any other Calendly operations.
 */
export async function getContext(
  opts: {
    timeoutMs?: number;
  } = {},
): Promise<CalendlyContext> {
  const timeoutMs = opts.timeoutMs ?? 10000;
  const startTime = Date.now();

  while (!window.location.hostname.includes('calendly.com')) {
    if (Date.now() - startTime > timeoutMs) {
      throw new Unauthenticated(`Not on Calendly domain. URL: ${window.location.href}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  const csrfMeta = document.querySelector<HTMLMetaElement>(
    'meta[name=csrf-token]',
  );
  const csrf = csrfMeta?.content;
  if (!csrf) {
    throw new Unauthenticated(
      `CSRF token not found in meta[name=csrf-token]. User may not be logged in. URL: ${window.location.href}`,
    );
  }

  const resp = await fetch('/api/user', {
    credentials: 'include',
    headers: {
      'X-CSRF-Token': csrf,
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/json',
    },
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, body);
  }

  const data = (await resp.json()) as {
    id?: number;
    uuid?: string;
    email?: string;
  };

  const userId = data.id;
  const userUuid = data.uuid;
  const email = data.email;

  if (!userId) {
    throw new ContractDrift('Could not extract user ID from /api/user response.');
  }
  if (!userUuid) {
    throw new ContractDrift('Could not extract user UUID from /api/user response.');
  }
  if (!email) {
    throw new ContractDrift('Could not extract email from /api/user response.');
  }

  return { csrf, userId, userUuid, email };
}

// ============================================================================
// Internal Helpers
// ============================================================================

async function calendlyFetch<T>(
  csrf: string,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: 'include',
    headers: {
      'X-CSRF-Token': csrf,
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => undefined);
    throwForStatus(response.status, body);
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  if (!text) return undefined as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    const truncated =
      text.length > 2000 ? text.slice(0, 2000) + '... [truncated]' : text;
    throw new ContractDrift(
      `Calendly returned non-JSON response from ${path}: ${truncated}`,
    );
  }
}

async function calendlyGraphQL<T>(
  csrf: string,
  query: string,
  variables: Record<string, unknown>,
  operationName: string,
): Promise<T> {
  const response = await fetch('/api/search', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'x-csrf-token': csrf,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables, operationName }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => undefined);
    throwForStatus(response.status, body);
  }

  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as { data?: T; errors?: unknown[] };
    if (parsed.errors && parsed.errors.length > 0) {
      throw new UpstreamError(
        `Calendly GraphQL errors: ${JSON.stringify(parsed.errors)}`,
      );
    }
    return parsed.data as T;
  } catch (err) {
    if (err instanceof UpstreamError) throw err;
    const truncated =
      text.length > 2000 ? text.slice(0, 2000) + '... [truncated]' : text;
    throw new ContractDrift(
      `Calendly returned non-JSON GraphQL response: ${truncated}`,
    );
  }
}

// ============================================================================
// User
// ============================================================================

/**
 * Get current user profile information.
 */
export async function getUser(opts: { csrf: string }): Promise<GetUserOutput> {
  const data = await calendlyFetch<{
    id?: number;
    email?: string;
    name?: string;
    booking_url?: string;
    timezone?: string;
    created_at?: string;
    events_count?: number;
  }>(opts.csrf, '/api/user');

  if (!data.id) {
    throw new ContractDrift('Could not extract user id from /api/user response.');
  }
  if (!data.email) {
    throw new ContractDrift('Could not extract email from /api/user response.');
  }

  return {
    id: data.id,
    email: data.email,
    name: data.name,
    booking_url: data.booking_url,
    timezone: data.timezone,
    created_at: data.created_at,
    events_count: data.events_count,
  };
}

// ============================================================================
// Organization
// ============================================================================

/**
 * Get organization details for the current user.
 */
export async function getOrganization(opts: {
  csrf: string;
}): Promise<GetOrganizationOutput> {
  const data = await calendlyFetch<{
    id?: number;
    name?: string;
    tier?: string;
    stage?: string;
    kind?: string;
    uri?: string;
    owner?: {
      id?: number;
      email?: string;
      name?: string;
    };
    organization?: {
      id?: number;
      name?: string;
      tier?: string;
      stage?: string;
      kind?: string;
      uri?: string;
      owner?: { id?: number; email?: string; name?: string };
    };
  }>(opts.csrf, '/api/organization');

  const org = (data as { organization?: typeof data }).organization ?? data;

  if (!org.id) {
    throw new ContractDrift(
      'Could not extract organization id from /api/organization response.',
    );
  }

  const owner = org.owner
    ? (() => {
        if (!org.owner!.id) {
          throw new ContractDrift(
            'Could not extract owner id from /api/organization response.',
          );
        }
        return {
          id: org.owner!.id,
          email: org.owner!.email,
          name: org.owner!.name,
        };
      })()
    : undefined;

  return {
    id: org.id,
    name: org.name ?? null,
    tier: org.tier,
    stage: org.stage,
    kind: org.kind,
    uri: org.uri,
    owner,
  };
}

// ============================================================================
// Event Types
// ============================================================================

/**
 * List all event types for the current user.
 *
 * Uses the paginated collection endpoint (`scope=personal&format=collection`)
 * which returns ~5 event types per page with `pagination.next_page` for more.
 * Automatically fetches all pages to return the complete set.
 */
export async function listEventTypes(opts: {
  csrf: string;
}): Promise<ListEventTypesOutput> {
  // Get user ID and name for the paginated endpoint
  const userData = await calendlyFetch<{ id?: number; name?: string }>(
    opts.csrf,
    '/api/user',
  );
  const userId = userData?.id;
  if (!userId) {
    throw new ContractDrift('Could not get user ID from /api/user');
  }

  // Paginate through all event types
  const allEventTypes: EventType[] = [];
  let page = 1;
  const maxPages = 20; // safety limit

  while (page <= maxPages) {
    const data = await calendlyFetch<{
      results: EventType[];
      pagination: { current_page: number; next_page: number | null };
    }>(
      opts.csrf,
      `/api/users/${userId}/event_types?scope=personal&format=collection&page=${page}`,
    );

    allEventTypes.push(...(data.results ?? []));

    if (!data.pagination?.next_page) break;
    page = data.pagination.next_page;
  }

  // Return in the standard grouped format for schema compatibility
  return {
    results: [
      {
        id: userId,
        name: userData.name ?? 'User',
        type: 'User',
        event_types: allEventTypes,
      },
    ],
  };
}

/**
 * Extract only the documented fields from a raw event type detail API response.
 */
function pickEventTypeDetail(raw: Record<string, unknown>): GetEventTypeOutput {
  return {
    id: raw.id as number,
    uuid: raw.uuid as string | undefined,
    name: raw.name as string,
    slug: raw.slug as string | undefined,
    active: raw.active as boolean | undefined,
    kind: raw.kind as string | undefined,
    kind_name: raw.kind_name as string | undefined,
    duration: raw.duration as number | undefined,
    min_booking_time: raw.min_booking_time as number | undefined,
    max_booking_time: raw.max_booking_time as number | undefined,
    before_buffer_time: raw.before_buffer_time as number | undefined,
    after_buffer_time: raw.after_buffer_time as number | undefined,
    booking_url: raw.booking_url as string | undefined,
    guests_allowed: raw.guests_allowed as boolean | undefined,
    cancellation_allowed: raw.cancellation_allowed as boolean | undefined,
    period_type: raw.period_type as string | undefined,
    pooling_type: raw.pooling_type as string | undefined,
    color: raw.color as string | undefined,
    description: raw.description as string | null | undefined,
    location_configurations:
      raw.location_configurations as GetEventTypeOutput['location_configurations'],
    invitees_limit: raw.invitees_limit as number | undefined,
    custom_fields: raw.custom_fields as GetEventTypeOutput['custom_fields'],
    next_availability: raw.next_availability as string | null | undefined,
  };
}

/**
 * Get detailed information about a single event type.
 */
export async function getEventType(opts: {
  csrf: string;
  userId: number;
  eventTypeId: number;
}): Promise<GetEventTypeOutput> {
  const raw = await calendlyFetch<Record<string, unknown>>(
    opts.csrf,
    `/api/users/${opts.userId}/event_types/${opts.eventTypeId}`,
  );
  return pickEventTypeDetail(raw);
}

/**
 * Create a new event type for the current user.
 */
export async function createEventType(opts: {
  csrf: string;
  userId: number;
  name: string;
  duration?: number;
  color?: string;
  description?: string;
  locations?: Array<{
    kind: string;
    location?: string;
    phone_number?: string;
    position?: number;
  }>;
}): Promise<GetEventTypeOutput> {
  const duration = opts.duration !== undefined ? opts.duration : 30;
  const color = opts.color !== undefined ? opts.color : '#8247f5';
  const description = opts.description !== undefined ? opts.description : null;

  const locationAttrs = (opts.locations ?? []).map((loc, i) => ({
    kind: loc.kind,
    position: loc.position ?? i,
    ...(loc.location !== undefined ? { location: loc.location } : {}),
    ...(loc.phone_number !== undefined
      ? { phone_number: loc.phone_number }
      : {}),
  }));

  const raw = await calendlyFetch<Record<string, unknown>>(
    opts.csrf,
    `/api/users/${opts.userId}/event_types`,
    {
      method: 'POST',
      body: JSON.stringify({
        name: opts.name,
        kind: 'solo',
        activate: true,
        duration,
        color,
        description,
        period_type: 'moving',
        max_booking_time: 86400,
        min_booking_time: 14400,
        hide_location: false,
        location_configurations_attributes: locationAttrs,
        event_type_memberships_attributes: [],
        origin: 'event_type_editor',
      }),
    },
  );
  return pickEventTypeDetail(raw);
}

/**
 * Update fields on an existing event type.
 */
export async function updateEventType(opts: {
  csrf: string;
  userId: number;
  eventTypeId: number;
  name?: string;
  description?: string;
  duration?: number;
  color?: string;
  locations?: Array<{
    kind: string;
    location?: string;
    phone_number?: string;
    position?: number;
  }>;
}): Promise<GetEventTypeOutput> {
  const body: Record<string, unknown> = {};
  if (opts.name !== undefined) body.name = opts.name;
  if (opts.description !== undefined) body.description = opts.description;
  if (opts.duration !== undefined) body.duration = opts.duration;
  if (opts.color !== undefined) body.color = opts.color;
  if (opts.locations !== undefined) {
    // Fetch existing locations to mark them for destruction (Rails nested attributes)
    const existing = await calendlyFetch<Record<string, unknown>>(
      opts.csrf,
      `/api/users/${opts.userId}/event_types/${opts.eventTypeId}`,
    );
    const existingLocs = (existing.location_configurations ?? []) as Array<{
      id: number;
    }>;
    const destroyAttrs = existingLocs.map((lc) => ({
      id: lc.id,
      _destroy: true,
    }));
    const newAttrs = opts.locations.map((loc, i) => ({
      kind: loc.kind,
      position: loc.position ?? i,
      ...(loc.location !== undefined ? { location: loc.location } : {}),
      ...(loc.phone_number !== undefined
        ? { phone_number: loc.phone_number }
        : {}),
    }));
    body.location_configurations_attributes = [...destroyAttrs, ...newAttrs];
  }

  const raw = await calendlyFetch<Record<string, unknown>>(
    opts.csrf,
    `/api/users/${opts.userId}/event_types/${opts.eventTypeId}`,
    {
      method: 'PUT',
      body: JSON.stringify(body),
    },
  );
  return pickEventTypeDetail(raw);
}

/**
 * Activate or deactivate an event type to control booking availability.
 */
export async function toggleEventType(opts: {
  csrf: string;
  userId: number;
  eventTypeId: number;
  active: boolean;
}): Promise<GetEventTypeOutput> {
  const action = opts.active ? 'activate' : 'deactivate';
  const raw = await calendlyFetch<Record<string, unknown>>(
    opts.csrf,
    `/api/users/${opts.userId}/event_types/${opts.eventTypeId}/${action}`,
    { method: 'PUT' },
  );
  return pickEventTypeDetail(raw);
}

/**
 * Clone an existing event type, creating a copy with a new ID.
 */
export async function cloneEventType(opts: {
  csrf: string;
  userId: number;
  eventTypeId: number;
}): Promise<GetEventTypeOutput> {
  const raw = await calendlyFetch<Record<string, unknown>>(
    opts.csrf,
    `/api/users/${opts.userId}/event_types/${opts.eventTypeId}/clone`,
    { method: 'POST' },
  );
  return pickEventTypeDetail(raw);
}

/**
 * Delete an event type permanently.
 */
export async function deleteEventType(opts: {
  csrf: string;
  userId: number;
  eventTypeId: number;
}): Promise<DeleteEventTypeOutput> {
  await calendlyFetch<unknown>(
    opts.csrf,
    `/api/users/${opts.userId}/event_types/${opts.eventTypeId}`,
    { method: 'DELETE' },
  );
  return { success: true };
}

// ============================================================================
// Meetings
// ============================================================================

const GET_MEETINGS_QUERY = `
query getMeetings($first: Int, $before: String, $after: String) {
  meetings(input: {
    pagination: { first: $first, before: $before, after: $after }
    filter: {
      kinds: [CALENDLY, GOOGLE]
      status: DEFAULT
      role: [HOST, COHOST]
      is_organizer: false
      include_notetaker_ineligible_external_events: true
      scope_type: my_calendly
    }
    orderBy: { start_time: DESC }
  }) {
    total
    edges {
      node {
        uuid
        owner_user_uuid
        kind
        name
        cancelled
        status
        start_time
        end_time
        location
        location_kind
        ... on CalendlyMeeting {
          invitees_limit
          invitees_count
          event_type {
            color
            kind
          }
        }
        meeting_intelligence {
          uuid
          status
          error
        }
        attendees {
          ... on InviteeAttendee {
            cancelled
            uuid
            rsvp
          }
          ... on HostAttendee {
            uuid
          }
          ... on CoHostAttendee {
            uuid
          }
          kind
          name
          email
          timezone
        }
      }
    }
    pageInfo {
      hasNextPage
      hasPreviousPage
      startCursor
      endCursor
    }
  }
}
`.trim();

/**
 * List scheduled meetings (upcoming or past) with cursor-based pagination.
 */
export async function listMeetings(opts: {
  csrf: string;
  period?: 'upcoming' | 'past';
  first?: number;
  after?: string;
}): Promise<ListMeetingsOutput> {
  const period: 'upcoming' | 'past' =
    opts.period !== undefined ? opts.period : 'upcoming';
  const first: number = opts.first !== undefined ? opts.first : 30;

  // Build the time filter: upcoming = GT now, past = LT now
  const now = new Date().toISOString();
  const operation = period === 'upcoming' ? 'GT' : 'LT';

  // The query uses a fixed filter structure; inject start_time at the variable level
  // by modifying the query for the time filter.
  const queryWithTimeFilter = GET_MEETINGS_QUERY.replace(
    'kinds: [CALENDLY, GOOGLE]',
    `start_time: { operation: ${operation}, start: "${now}" }
      kinds: [CALENDLY, GOOGLE]`,
  );

  const variables: Record<string, unknown> = {
    first,
    role: ['HOST', 'COHOST'],
    isOrganizer: false,
    period,
    statusIds: ['active'],
    schedulingMethods: ['google', 'calendly'],
    scopeType: 'my_calendly',
    scopeId: '',
    includeNotetakerIneligibleExternalEvents: true,
    order: 'DESC',
    past: period === 'past',
  };

  if (opts.after) {
    variables.after = opts.after;
    variables.isPrevious = true;
  }

  const data = await calendlyGraphQL<{
    meetings?: {
      total?: number;
      edges?: Array<{
        node?: {
          uuid?: string;
          name?: string;
          status?: string;
          cancelled?: boolean;
          kind?: string;
          start_time?: number;
          end_time?: number;
          location?: string;
          location_kind?: string;
          owner_user_uuid?: string;
          invitees_limit?: number;
          invitees_count?: number;
          attendees?: Array<{
            kind?: string;
            name?: string;
            email?: string;
            timezone?: string;
            uuid?: string;
            cancelled?: boolean;
            rsvp?: string;
          }>;
        };
      }>;
      pageInfo?: {
        hasNextPage?: boolean;
        hasPreviousPage?: boolean;
        startCursor?: string | null;
        endCursor?: string | null;
      };
    };
  }>(opts.csrf, queryWithTimeFilter, variables, 'getMeetings');

  const meetings = data?.meetings;
  if (!meetings) {
    throw new ContractDrift('Unexpected response shape from /api/search getMeetings.');
  }

  const edges = meetings.edges ?? [];

  return {
    meetings: edges
      .map((e) => e.node)
      .filter((n): n is NonNullable<typeof n> => !!n)
      .map((n) => {
        if (!n.uuid) {
          throw new ContractDrift(
            'Meeting node missing uuid in /api/search getMeetings response.',
          );
        }
        return {
          uuid: n.uuid,
          name: n.name,
          status: n.status,
          cancelled: n.cancelled,
          kind: n.kind,
          start_time: n.start_time,
          end_time: n.end_time,
          location: n.location,
          location_kind: n.location_kind,
          owner_user_uuid: n.owner_user_uuid,
          invitees_limit: n.invitees_limit,
          invitees_count: n.invitees_count,
          attendees: n.attendees?.map((a) => ({
            kind: a.kind,
            name: a.name,
            email: a.email,
            timezone: a.timezone,
            uuid: a.uuid,
            cancelled: a.cancelled,
            rsvp: a.rsvp,
          })),
        };
      }),
    total: meetings.total !== undefined ? meetings.total : 0,
    pageInfo: {
      hasNextPage: meetings.pageInfo?.hasNextPage === true,
      hasPreviousPage: meetings.pageInfo?.hasPreviousPage === true,
      startCursor:
        meetings.pageInfo?.startCursor !== undefined
          ? meetings.pageInfo.startCursor
          : null,
      endCursor:
        meetings.pageInfo?.endCursor !== undefined
          ? meetings.pageInfo.endCursor
          : null,
    },
  };
}
