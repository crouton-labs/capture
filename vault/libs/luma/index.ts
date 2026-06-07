import type {
  GetContextOutput,
  GetContextInput,
  GetEventInput,
  GetEventOutput,
  ResolveUrlInput,
  ResolveUrlOutput,
  ListCalendarEventsInput,
  ListCalendarEventsOutput,
  DiscoverEventsInput,
  DiscoverEventsOutput,
  ListCategoriesInput,
  ListCategoriesOutput,
  SearchInput,
  SearchOutput,
  GetUserProfileInput,
  GetUserProfileOutput,
  GetUserEventsInput,
  GetUserEventsOutput,
  ListNotificationsInput,
  ListNotificationsOutput,
  GetEventGuestsInput,
  GetEventGuestsOutput,
  UpdateEventInput,
  UpdateEventOutput,
  CancelEventInput,
  CancelEventOutput,
  InviteGuestsInput,
  InviteGuestsOutput,
  UpdateGuestStatusesInput,
  UpdateGuestStatusesOutput,
} from './schemas';
import { ContractDrift, NotFound, Unauthenticated, PermissionDenied, Validation, throwForStatus } from '@vallum/_runtime';

// ============================================================================
// Internal types
// ============================================================================

interface LumaNextData {
  props?: {
    initialUserData?: {
      user?: {
        api_id?: string;
        name?: string;
        email?: string;
        avatar_url?: string;
        timezone?: string;
        geo_city?: string;
        geo_country?: string;
      };
    };
    latitude?: string;
    longitude?: string;
  };
}

interface LumaEventData {
  api_id?: string;
  calendar_api_id?: string;
  cover_url?: string;
  end_at?: string;
  event_type?: string;
  hide_rsvp?: boolean;
  location_type?: string;
  name?: string;
  one_to_one?: boolean;
  recurrence_id?: string | null;
  show_guest_list?: boolean;
  start_at?: string;
  timezone?: string;
  url?: string;
  user_api_id?: string;
  visibility?: string;
  virtual_info?: Record<string, unknown>;
  geo_address_info?: { full_address?: string };
  geo_address_visibility?: string;
  coordinate?: { latitude?: number; longitude?: number };
  waitlist_enabled?: boolean;
  waitlist_status?: string;
}

interface LumaEventDetail {
  api_id?: string;
  event?: LumaEventData;
  calendar?: {
    api_id?: string;
    name?: string;
    avatar_url?: string;
  };
  guest_count?: number;
  ticket_count?: number;
  hosts?: Array<{
    api_id?: string;
    name?: string;
    username?: string;
    avatar_url?: string;
  }>;
  waitlist_active?: boolean;
  sold_out?: boolean;
  role?: {
    type?: string;
    approval_status?: string;
  } | null;
  manage_access?: unknown;
  cover_image?: { url?: string };
}

interface LumaCalendarEntry {
  api_id?: string;
  event?: LumaEventData;
  calendar?: { api_id?: string; name?: string };
  start_at?: string;
  hosts?: Array<{ name?: string; avatar_url?: string }>;
  guest_count?: number;
  status?: string;
  cover_image?: { url?: string };
  is_manager?: boolean;
}

interface LumaPaginatedResponse<T> {
  entries?: T[];
  has_more?: boolean;
  next_cursor?: string;
}

interface LumaUrlResolveResponse {
  kind?: string;
  data?: Record<string, unknown>;
}

interface LumaSearchResponse {
  query?: string;
  calendars?: Array<{ api_id?: string; name?: string; avatar_url?: string }>;
  events?: Array<{
    api_id?: string;
    event?: {
      api_id?: string;
      name?: string;
      url?: string;
      start_at?: string;
      cover_url?: string;
      calendar_api_id?: string;
    };
  }>;
  discover_entities?: Array<{
    api_id?: string;
    name?: string;
    type?: string;
    path?: string;
  }>;
}

interface LumaUserProfile {
  event_attended_count?: number;
  event_hosted_count?: number;
  event_together_count?: number;
  joined_at?: string;
  user?: {
    api_id?: string;
    name?: string;
    username?: string;
    avatar_url?: string;
    bio_short?: string;
    is_verified?: boolean;
    twitter_handle?: string;
    instagram_handle?: string;
    linkedin_handle?: string;
    website?: string;
  };
}

interface LumaUserEventsResponse {
  events_hosting?: Array<{
    api_id?: string;
    event?: LumaEventData;
    cover_image?: { url?: string };
    start_at?: string;
  }>;
  events_past?: Array<{
    api_id?: string;
    event?: LumaEventData;
    cover_image?: { url?: string };
    start_at?: string;
  }>;
  events_together?: unknown[];
}

interface LumaCategoryEntry {
  api_id?: string;
  category?: {
    api_id?: string;
    name?: string;
    description?: string;
    event_count?: number;
    icon_url?: string;
    page_title?: string;
  };
}

interface LumaNotificationEntry {
  api_id?: string;
  notification?: {
    type?: string;
    title?: string;
    original_action_at?: string;
  };
  event?: {
    api_id?: string;
    name?: string;
  };
  calendar?: {
    api_id?: string;
    name?: string;
  };
}

interface LumaGuestEntry {
  api_id?: string;
  name?: string | null;
  email?: string | null;
  linkedin_handle?: string | null;
  approval_status?: string | null;
  geo_city?: string | null;
  geo_country?: string | null;
  created_at?: string | null;
  registered_at?: string | null;
  invited_at?: string | null;
  user_api_id?: string | null;
  avatar_url?: string | null;
}

// ============================================================================
// Helpers
// ============================================================================

const API_BASE = 'https://api2.luma.com';

async function lumaFetch<T>(path: string): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { accept: 'application/json' },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, body);
  }
  return resp.json() as Promise<T>;
}

async function lumaPost<T>(path: string, body: unknown): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-luma-client-type': 'luma-web',
      'x-luma-web-url': window.location.href,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, text);
  }
  return resp.json() as Promise<T>;
}

function str(v: string | undefined): string {
  if (!v) throw new ContractDrift(`Expected string, got ${String(v)}`);
  return v;
}

function strOpt(v: string | undefined): string | null {
  return v !== undefined && v !== '' ? v : null;
}

/** Returns the string value or empty string (never throws). Use for non-critical fields. */
function strEmpty(v: string | undefined): string {
  return v !== undefined ? v : '';
}

function numOpt(v: number | undefined): number | null {
  return typeof v === 'number' ? v : null;
}

function boolVal(v: boolean | undefined): boolean {
  return v === true;
}

function extractAddress(event: LumaEventData | undefined): string | null {
  return strOpt(event?.geo_address_info?.full_address);
}

function mapHostSummary(h: { name?: string; avatar_url?: string }): {
  name: string;
  avatarUrl: string | null;
} {
  return { name: strEmpty(h.name), avatarUrl: strOpt(h.avatar_url) };
}

// ============================================================================
// Context
// ============================================================================

export async function getContext(
  _args: GetContextInput,
): Promise<GetContextOutput> {
  const nextData = (window as unknown as { __NEXT_DATA__?: LumaNextData })
    .__NEXT_DATA__;

  const user = nextData?.props?.initialUserData?.user;
  if (!user?.api_id) {
    throw new Unauthenticated(
      'Luma user not found. Ensure you are signed in at lu.ma/home.',
    );
  }
  if (!user.name) {
    throw new Unauthenticated('Luma user name not found in page data.');
  }
  if (!user.email) {
    throw new Unauthenticated('Luma user email not found in page data.');
  }

  return {
    userApiId: user.api_id,
    name: user.name,
    email: user.email,
    avatarUrl: strOpt(user.avatar_url),
    timezone: strEmpty(user.timezone),
    geoCity: strOpt(user.geo_city),
    geoCountry: strOpt(user.geo_country),
    latitude: strOpt(nextData?.props?.latitude),
    longitude: strOpt(nextData?.props?.longitude),
  };
}

// ============================================================================
// Events
// ============================================================================

export async function getEvent(args: GetEventInput): Promise<GetEventOutput> {
  const detail = await lumaFetch<LumaEventDetail>(
    `/event/get?event_api_id=${encodeURIComponent(args.eventApiId)}`,
  );

  if (!detail.api_id) {
    throw new NotFound(`Event not found: ${args.eventApiId}`);
  }

  const ev = detail.event;

  return {
    apiId: detail.api_id,
    name: str(ev?.name),
    url: str(ev?.url),
    startAt: strOpt(ev?.start_at),
    endAt: strOpt(ev?.end_at),
    timezone: strOpt(ev?.timezone),
    locationType: strOpt(ev?.location_type),
    locationAddress: extractAddress(ev),
    coverUrl: strOpt(detail.cover_image?.url ?? ev?.cover_url),
    eventType: strOpt(ev?.event_type),
    visibility: strOpt(ev?.visibility),
    guestCount: numOpt(detail.guest_count),
    ticketCount: numOpt(detail.ticket_count),
    calendarApiId: strOpt(ev?.calendar_api_id ?? detail.calendar?.api_id),
    calendarName: strOpt(detail.calendar?.name),
    hosts: (detail.hosts ?? []).map((h) => ({
      apiId: strEmpty(h.api_id),
      name: strEmpty(h.name),
      username: strOpt(h.username),
      avatarUrl: strOpt(h.avatar_url),
    })),
    waitlistActive: boolVal(detail.waitlist_active),
    soldOut: boolVal(detail.sold_out),
    role: detail.role
      ? {
          type: strEmpty(detail.role.type),
          approvalStatus: strOpt(detail.role.approval_status),
        }
      : null,
  };
}

export async function resolveUrl(
  args: ResolveUrlInput,
): Promise<ResolveUrlOutput> {
  const data = await lumaFetch<LumaUrlResolveResponse>(
    `/url?url=${encodeURIComponent(args.slug)}`,
  );

  if (!data.kind) {
    throw new ContractDrift(`Could not resolve Luma URL slug: ${args.slug}`);
  }

  const entityData = data.data;

  return {
    kind: data.kind,
    eventApiId:
      data.kind === 'event'
        ? strOpt(entityData?.api_id as string | undefined)
        : null,
    calendarApiId:
      data.kind === 'calendar'
        ? strOpt(entityData?.api_id as string | undefined)
        : null,
    name: strOpt(entityData?.name as string | undefined),
  };
}

// ============================================================================
// Calendar
// ============================================================================

export async function listCalendarEvents(
  args: ListCalendarEventsInput,
): Promise<ListCalendarEventsOutput> {
  const params = new URLSearchParams({
    calendar_api_id: args.calendarApiId,
    period: args.period !== undefined ? args.period : 'future',
    pagination_limit: String(args.paginationLimit ?? 20),
  });
  if (args.paginationCursor) {
    params.set('pagination_cursor', args.paginationCursor);
  }

  const resp = await lumaFetch<LumaPaginatedResponse<LumaCalendarEntry>>(
    `/calendar/get-items?${params.toString()}`,
  );

  return {
    entries: (resp.entries ?? []).map((entry) => ({
      apiId: strEmpty(entry.api_id),
      eventApiId: strEmpty(entry.event?.api_id),
      name: strEmpty(entry.event?.name),
      url: strEmpty(entry.event?.url),
      startAt: strOpt(entry.start_at ?? entry.event?.start_at),
      endAt: strOpt(entry.event?.end_at),
      timezone: strOpt(entry.event?.timezone),
      coverUrl: strOpt(entry.cover_image?.url ?? entry.event?.cover_url),
      locationType: strOpt(entry.event?.location_type),
      locationAddress: extractAddress(entry.event),
      guestCount: numOpt(entry.guest_count),
      hosts: (entry.hosts ?? []).map(mapHostSummary),
      status: strOpt(entry.status),
    })),
    hasMore: boolVal(resp.has_more),
    nextCursor: strOpt(resp.next_cursor),
  };
}

// ============================================================================
// Discover
// ============================================================================

export async function discoverEvents(
  args: DiscoverEventsInput,
): Promise<DiscoverEventsOutput> {
  const params = new URLSearchParams({
    category_slug: args.slug,
    latitude: String(args.latitude),
    longitude: String(args.longitude),
    pagination_limit: String(args.paginationLimit ?? 10),
  });
  if (args.paginationCursor) {
    params.set('pagination_cursor', args.paginationCursor);
  }

  const resp = await lumaFetch<LumaPaginatedResponse<LumaCalendarEntry>>(
    `/discover/get-paginated-events?${params.toString()}`,
  );

  return {
    entries: (resp.entries ?? []).map((entry) => ({
      eventApiId: strEmpty(entry.event?.api_id),
      name: strEmpty(entry.event?.name),
      url: strEmpty(entry.event?.url),
      startAt: strOpt(entry.start_at ?? entry.event?.start_at),
      endAt: strOpt(entry.event?.end_at),
      timezone: strOpt(entry.event?.timezone),
      coverUrl: strOpt(entry.cover_image?.url ?? entry.event?.cover_url),
      locationType: strOpt(entry.event?.location_type),
      locationAddress: extractAddress(entry.event),
      guestCount: numOpt(entry.guest_count),
      calendarApiId: strOpt(
        entry.event?.calendar_api_id ?? entry.calendar?.api_id,
      ),
      calendarName: strOpt(entry.calendar?.name),
      hosts: (entry.hosts ?? []).map(mapHostSummary),
    })),
    hasMore: boolVal(resp.has_more),
    nextCursor: strOpt(resp.next_cursor),
  };
}

export async function listCategories(
  args: ListCategoriesInput,
): Promise<ListCategoriesOutput> {
  const resp = await lumaFetch<{ entries?: LumaCategoryEntry[] }>(
    `/discover/category/list-categories?pagination_limit=${args.limit ?? 20}`,
  );

  return {
    categories: (resp.entries ?? []).map((entry) => ({
      apiId: strEmpty(entry.category?.api_id ?? entry.api_id),
      name: strEmpty(entry.category?.name),
      slug: strEmpty(entry.category?.api_id).replace('cat-', ''),
      description: strOpt(entry.category?.description),
      eventCount: numOpt(entry.category?.event_count),
      iconUrl: strOpt(entry.category?.icon_url),
    })),
  };
}

// ============================================================================
// Search
// ============================================================================

export async function search(args: SearchInput): Promise<SearchOutput> {
  const resp = await lumaFetch<LumaSearchResponse>(
    `/search/get-results?query=${encodeURIComponent(args.query)}`,
  );

  return {
    events: (resp.events ?? []).map((e) => ({
      eventApiId: strEmpty(e.event?.api_id ?? e.api_id),
      name: strEmpty(e.event?.name),
      url: strEmpty(e.event?.url),
      startAt: strOpt(e.event?.start_at),
      coverUrl: strOpt(e.event?.cover_url),
      calendarApiId: strOpt(e.event?.calendar_api_id),
    })),
    calendars: (resp.calendars ?? []).map((c) => ({
      apiId: strEmpty(c.api_id),
      name: strEmpty(c.name),
      avatarUrl: strOpt(c.avatar_url),
    })),
    discoverEntities: (resp.discover_entities ?? []).map((d) => ({
      apiId: strEmpty(d.api_id),
      name: strEmpty(d.name),
      type: strEmpty(d.type),
      path: strOpt(d.path),
    })),
  };
}

// ============================================================================
// User Profile
// ============================================================================

export async function getUserProfile(
  args: GetUserProfileInput,
): Promise<GetUserProfileOutput> {
  const resp = await lumaFetch<LumaUserProfile>(
    `/user/profile?username=${encodeURIComponent(args.username)}`,
  );

  const user = resp.user;
  if (!user?.api_id) {
    throw new NotFound(`User not found: ${args.username}`);
  }

  return {
    userApiId: user.api_id,
    name: strEmpty(user.name),
    username: strOpt(user.username),
    avatarUrl: strOpt(user.avatar_url),
    bioShort: strOpt(user.bio_short),
    isVerified: boolVal(user.is_verified),
    twitterHandle: strOpt(user.twitter_handle),
    instagramHandle: strOpt(user.instagram_handle),
    linkedinHandle: strOpt(user.linkedin_handle),
    websiteUrl: strOpt(user.website),
    eventAttendedCount: resp.event_attended_count ?? 0,
    eventHostedCount: resp.event_hosted_count ?? 0,
    joinedAt: strOpt(resp.joined_at),
  };
}

export async function getUserEvents(
  args: GetUserEventsInput,
): Promise<GetUserEventsOutput> {
  const resp = await lumaFetch<LumaUserEventsResponse>(
    `/user/profile/events?username=${encodeURIComponent(args.username)}`,
  );

  type EventEntry = NonNullable<
    LumaUserEventsResponse['events_hosting']
  >[number];

  const mapEvent = (e: EventEntry) => ({
    eventApiId: strEmpty(e.event?.api_id ?? e.api_id),
    name: strEmpty(e.event?.name),
    url: strEmpty(e.event?.url),
    startAt: strOpt(e.start_at ?? e.event?.start_at),
    coverUrl: strOpt(e.cover_image?.url ?? e.event?.cover_url),
  });

  return {
    eventsHosting: (resp.events_hosting ?? []).map(mapEvent),
    eventsPast: (resp.events_past ?? []).map(mapEvent),
  };
}

// ============================================================================
// Notifications
// ============================================================================

export async function listNotifications(
  args: ListNotificationsInput,
): Promise<ListNotificationsOutput> {
  const params = new URLSearchParams({
    pagination_limit: String(args.limit ?? 10),
  });
  if (args.paginationCursor) {
    params.set('pagination_cursor', args.paginationCursor);
  }

  const resp = await lumaFetch<LumaPaginatedResponse<LumaNotificationEntry>>(
    `/notifications/list?${params.toString()}`,
  );

  return {
    entries: (resp.entries ?? []).map((entry) => ({
      apiId: str(entry.api_id),
      type: strEmpty(entry.notification?.type),
      title: strEmpty(entry.notification?.title),
      actionAt: strOpt(entry.notification?.original_action_at),
      eventApiId: strOpt(entry.event?.api_id),
      eventName: strOpt(entry.event?.name),
      calendarApiId: strOpt(entry.calendar?.api_id),
      calendarName: strOpt(entry.calendar?.name),
    })),
    hasMore: boolVal(resp.has_more),
    nextCursor: strOpt(resp.next_cursor),
  };
}

// ============================================================================
// Event Guests
// ============================================================================

export async function getEventGuests(
  args: GetEventGuestsInput,
): Promise<GetEventGuestsOutput> {
  const params = new URLSearchParams({
    event_api_id: args.eventApiId,
    pagination_limit: String(args.paginationLimit ?? 50),
  });
  if (args.approvalStatus) {
    params.set('approval_status', args.approvalStatus);
  }
  if (args.paginationCursor) {
    params.set('pagination_cursor', args.paginationCursor);
  }

  const resp = await lumaFetch<LumaPaginatedResponse<LumaGuestEntry>>(
    `/event/admin/get-guests?${params.toString()}`,
  );

  return {
    entries: (resp.entries ?? []).map((entry) => ({
      apiId: str(entry.api_id),
      name: strOpt(entry.name ?? undefined),
      email: strOpt(entry.email ?? undefined),
      linkedinHandle: strOpt(entry.linkedin_handle ?? undefined),
      approvalStatus: strOpt(entry.approval_status ?? undefined),
      geoCity: strOpt(entry.geo_city ?? undefined),
      geoCountry: strOpt(entry.geo_country ?? undefined),
      createdAt: strOpt(
        entry.registered_at ??
          entry.created_at ??
          entry.invited_at ??
          undefined,
      ),
      userApiId: strOpt(entry.user_api_id ?? undefined),
    })),
    hasMore: boolVal(resp.has_more),
    nextCursor: strOpt(resp.next_cursor),
  };
}

// ============================================================================
// Event Management (host/manager only)
// ============================================================================

interface LumaAdminEvent {
  api_id: string;
  name: string;
  start_at: string;
  end_at: string;
  timezone: string;
  location_type: string;
  coordinate: unknown;
  description_mirror: unknown;
  duration_interval: string;
  font_title: string;
  geo_address_json: unknown;
  geo_address_visibility: string;
  theme_meta: unknown;
  tint_color: string;
  zoom_creation_method: string;
  zoom_meeting_id: string | null;
  zoom_meeting_password: string | null;
  zoom_meeting_url: string | null;
  zoom_session_type: string | null;
}

export async function updateEvent(
  args: UpdateEventInput,
): Promise<UpdateEventOutput> {
  const current = await lumaFetch<{
    access_level?: string;
    event: LumaAdminEvent;
  }>(`/event/admin/get?event_api_id=${encodeURIComponent(args.eventApiId)}`);

  if (!current.access_level || current.access_level === 'none') {
    throw new PermissionDenied(
      `Not authorized to edit event ${args.eventApiId} (access_level=${String(current.access_level)})`,
    );
  }

  const ev = current.event;

  const descriptionMirror =
    args.description !== undefined
      ? {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: args.description
                ? [{ type: 'text', text: args.description }]
                : [],
            },
          ],
        }
      : ev.description_mirror;

  // end time is encoded as an ISO 8601 duration relative to start, not stored separately
  let durationInterval = ev.duration_interval;
  if (args.endAt !== undefined) {
    const startMs = new Date(args.startAt ?? ev.start_at).getTime();
    const endMs = new Date(args.endAt).getTime();
    if (
      !Number.isFinite(startMs) ||
      !Number.isFinite(endMs) ||
      endMs <= startMs
    ) {
      throw new Validation(
        `updateEvent: endAt must be a valid ISO datetime after startAt (got startAt=${String(args.startAt ?? ev.start_at)}, endAt=${args.endAt})`,
      );
    }
    const totalSeconds = Math.round((endMs - startMs) / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    durationInterval = `P0Y0M0DT${hours}H${minutes}M${seconds}S`;
  }

  const payload = {
    event_api_id: args.eventApiId,
    coordinate: ev.coordinate,
    description_mirror: descriptionMirror,
    duration_interval: durationInterval,
    font_title: ev.font_title,
    geo_address_json: ev.geo_address_json,
    geo_address_visibility: ev.geo_address_visibility,
    location_type: args.locationType ?? ev.location_type,
    name: args.name ?? ev.name,
    start_at: args.startAt ?? ev.start_at,
    theme_meta: ev.theme_meta,
    timezone: args.timezone ?? ev.timezone,
    tint_color: ev.tint_color,
    zoom_creation_method: ev.zoom_creation_method,
    zoom_meeting_id: ev.zoom_meeting_id,
    zoom_meeting_password: ev.zoom_meeting_password,
    zoom_meeting_url: args.virtualUrl ?? ev.zoom_meeting_url,
    zoom_session_type: ev.zoom_session_type,
  };

  await lumaPost<unknown>('/event/admin/update', payload);

  // Fetch fresh state so the caller sees what actually took effect
  const updated = await lumaFetch<{ event: LumaAdminEvent }>(
    `/event/admin/get?event_api_id=${encodeURIComponent(args.eventApiId)}`,
  );

  return {
    eventApiId: updated.event.api_id,
    name: updated.event.name,
    startAt: strOpt(updated.event.start_at),
    endAt: strOpt(updated.event.end_at),
    locationType: strOpt(updated.event.location_type),
    timezone: strOpt(updated.event.timezone),
  };
}

export async function cancelEvent(
  args: CancelEventInput,
): Promise<CancelEventOutput> {
  await lumaPost<unknown>('/event/admin/cancel-event', {
    event_api_id: args.eventApiId,
  });

  return {
    eventApiId: args.eventApiId,
    canceled: true,
  };
}

// ============================================================================
// Guest Management (host/manager only)
// ============================================================================

export async function inviteGuests(
  args: InviteGuestsInput,
): Promise<InviteGuestsOutput> {
  const people = args.emails.map((email) => ({
    type: 'email' as const,
    email,
  }));

  const resp = await lumaPost<{ task_id?: string }>(
    '/event/admin/invite/send',
    {
      event_api_id: args.eventApiId,
      message: args.message,
      people,
    },
  );

  if (!resp.task_id) {
    throw new ContractDrift('Luma invite/send did not return a task_id');
  }

  return {
    taskId: resp.task_id,
    invitedCount: args.emails.length,
  };
}

export async function updateGuestStatuses(
  args: UpdateGuestStatusesInput,
): Promise<UpdateGuestStatusesOutput> {
  const customMessage = {
    type: 'doc',
    content: args.customMessage
      ? [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: args.customMessage }],
          },
        ]
      : [{ type: 'paragraph' }],
  };

  const resp = await lumaPost<{ task_id?: string }>(
    '/event/admin/update-guests-statuses',
    {
      event_api_id: args.eventApiId,
      rsvp_api_ids: args.guestApiIds,
      suppress_email: args.suppressEmail,
      custom_message: customMessage,
      approval_status: args.approvalStatus,
      event_ticket_type_api_id: args.eventTicketTypeApiId ?? null,
    },
  );

  if (!resp.task_id) {
    throw new ContractDrift('Luma update-guests-statuses did not return a task_id');
  }

  return {
    taskId: resp.task_id,
    updatedCount: args.guestApiIds.length,
  };
}
