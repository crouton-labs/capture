import type {
  GetContextOutput,
  ListMyEventsInput,
  ListMyEventsOutput,
  GetEventsByIdsInput,
  GetEventsByIdsOutput,
  GetMySavedEventsInput,
  GetMySavedEventsOutput,
  GetMyFollowedEventsInput,
  GetMyFollowedEventsOutput,
  GetEventCommentsInput,
  GetEventCommentsOutput,
  GetEventMediaInput,
  GetEventMediaOutput,
  GetUsersInput,
  GetUsersOutput,
  GetMutualsInput,
  GetMutualsOutput,
  GetContactsInput,
  GetContactsOutput,
} from './schemas';

import { throwForStatus } from '@vallum/_runtime';

// ============================================================================
// Internal types for Partiful API responses
// ============================================================================

interface FirebaseAuthUser {
  uid: string;
  displayName: string | null;
  stsTokenManager: {
    accessToken: string;
    expirationTime: number;
  };
}

interface FirebaseIDBEntry {
  fbase_key: string;
  value: FirebaseAuthUser;
}

interface PartifulApiResponse<T> {
  result: {
    data: T;
  };
}

interface RawEvent {
  id: string;
  title: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  timezone: string | null;
  description: string | null;
  ownerIds: string[];
  image?: {
    url?: string;
  } | null;
  respondedGuestCount?: number | null;
  approvedGuestCount?: number | null;
  goingGuestCount?: number | null;
  waitlistGuestCount?: number | null;
  guestAction?: string | null;
  showGuestCount?: boolean | null;
  findATime?: unknown;
}

interface RawUser {
  id: string;
  name: string | null;
  photo?: {
    url?: string;
    upload?: {
      url?: string;
    };
  } | null;
  createdAt?: string | null;
  birthdayMonth?: number | null;
  socials?: {
    instagram?: { value?: string; visibility?: string } | null;
  } | null;
  onPartiful?: boolean | null;
}

interface RawMutual {
  userId: string;
  name: string;
  sharedEventCount: number;
  isPastGuest: boolean | null;
  sharedEvent: {
    id: string;
    title: string;
    startDate: string;
  } | null;
}

interface RawContact {
  id: string;
  name: string;
  sharedEventCount: number;
  isPastGuest: boolean | null;
  sharedEvent: {
    id: string;
    title: string;
    startDate: string;
  } | null;
}

interface RawComment {
  id: string;
  message: string;
  createdAt: string;
  publicUserId?: string | null;
  publicUserName?: string | null;
  reactionMap?: Record<string, Record<string, unknown>> | null;
}

interface RawMedia {
  id?: string;
  type?: string;
  upload?: {
    url?: string;
    uploadedAt?: string;
  } | null;
  uploaderId?: string | null;
  url?: string | null;
}

// ============================================================================
// Internal helpers
// ============================================================================

const API_BASE = 'https://api.partiful.com';

function makeHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

function makeBody(
  userId: string,
  params: Record<string, unknown>,
  paging?: { cursor: string | null; maxResults: number },
): string {
  const body: Record<string, unknown> = {
    data: {
      params,
      userId,
    },
  };
  if (paging) {
    (body.data as Record<string, unknown>).paging = paging;
  }
  return JSON.stringify(body);
}

async function apiPost<T>(
  token: string,
  userId: string,
  endpoint: string,
  params: Record<string, unknown>,
  paging?: { cursor: string | null; maxResults: number },
): Promise<T> {
  const resp = await fetch(`${API_BASE}/${endpoint}`, {
    method: 'POST',
    headers: makeHeaders(token),
    body: makeBody(userId, params, paging),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, text);
  }
  const json = (await resp.json()) as PartifulApiResponse<T>;
  return json.result.data;
}

function normalizeEvent(raw: RawEvent) {
  return {
    id: raw.id,
    title: raw.title,
    status: raw.status,
    startDate: raw.startDate ?? null,
    endDate: raw.endDate ?? null,
    timezone: raw.timezone ?? null,
    description: raw.description ?? null,
    ownerIds: Array.isArray(raw.ownerIds) ? raw.ownerIds : [],
    imageUrl: raw.image?.url ?? null,
    respondedGuestCount: raw.respondedGuestCount ?? null,
    approvedGuestCount: raw.approvedGuestCount ?? null,
    goingGuestCount: raw.goingGuestCount ?? null,
    waitlistGuestCount: raw.waitlistGuestCount ?? null,
    guestAction: raw.guestAction ?? null,
    showGuestCount: raw.showGuestCount ?? null,
  };
}

function normalizeUser(raw: RawUser) {
  return {
    id: raw.id,
    name: raw.name ?? null,
    photoUrl: raw.photo?.url ?? raw.photo?.upload?.url ?? null,
    createdAt: raw.createdAt ?? null,
    birthdayMonth: raw.birthdayMonth ?? null,
    instagram: raw.socials?.instagram?.value ?? null,
    onPartiful: raw.onPartiful ?? null,
  };
}

// ============================================================================
// Context
// ============================================================================

export async function getContext(): Promise<GetContextOutput> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('firebaseLocalStorageDb');
    req.onerror = () =>
      reject(
        new Error(
          'Failed to open Firebase IDB. Ensure Partiful is open and logged in.',
        ),
      );
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('firebaseLocalStorage', 'readonly');
      const store = tx.objectStore('firebaseLocalStorage');
      const allReq = store.getAll();
      allReq.onsuccess = () => {
        const items = allReq.result as FirebaseIDBEntry[];
        const authEntry = items.find(
          (item) => item.fbase_key && item.fbase_key.includes('authUser'),
        );
        if (!authEntry) {
          reject(
            new Error(
              'No Firebase auth session found. Ensure you are logged into Partiful.',
            ),
          );
          return;
        }
        const user = authEntry.value;
        if (!user.stsTokenManager?.accessToken) {
          reject(
            new Error('Firebase auth token missing. Try refreshing the page.'),
          );
          return;
        }
        if (!user.displayName) {
          reject(
            new Error(
              'Firebase user displayName missing. Ensure Partiful profile is complete.',
            ),
          );
          return;
        }
        resolve({
          token: user.stsTokenManager.accessToken,
          userId: user.uid,
          displayName: user.displayName,
        });
      };
      allReq.onerror = () =>
        reject(new Error('Failed to read Firebase auth from IDB.'));
    };
  });
}

// ============================================================================
// Events
// ============================================================================

export async function listMyEvents(
  args: ListMyEventsInput,
): Promise<ListMyEventsOutput> {
  const data = await apiPost<{ upcomingEvents: RawEvent[] }>(
    args.token,
    args.userId,
    'getMyUpcomingEventsForHomePage',
    {},
  );
  return {
    events: Array.isArray(data.upcomingEvents)
      ? data.upcomingEvents.map(normalizeEvent)
      : [],
  };
}

export async function getEventsByIds(
  args: GetEventsByIdsInput,
): Promise<GetEventsByIdsOutput> {
  const data = await apiPost<{ events: RawEvent[] }>(
    args.token,
    args.userId,
    'getEventsByIds',
    { eventIds: args.eventIds },
  );
  return {
    events: Array.isArray(data.events) ? data.events.map(normalizeEvent) : [],
  };
}

export async function getMySavedEvents(
  args: GetMySavedEventsInput,
): Promise<GetMySavedEventsOutput> {
  const data = await apiPost<{ events: RawEvent[] }>(
    args.token,
    args.userId,
    'getMySavedEvents',
    {},
  );
  return {
    events: Array.isArray(data.events) ? data.events.map(normalizeEvent) : [],
  };
}

export async function getMyFollowedEvents(
  args: GetMyFollowedEventsInput,
): Promise<GetMyFollowedEventsOutput> {
  const data = await apiPost<{ events: RawEvent[] }>(
    args.token,
    args.userId,
    'getMyFollowedEvents',
    {},
  );
  return {
    events: Array.isArray(data.events) ? data.events.map(normalizeEvent) : [],
  };
}

export async function getEventComments(
  args: GetEventCommentsInput,
): Promise<GetEventCommentsOutput> {
  const data = await apiPost<{ comments: RawComment[] }>(
    args.token,
    args.userId !== null && args.userId !== undefined ? args.userId : '',
    'getEventComments',
    { eventId: args.eventId },
  );

  const rawComments = Array.isArray(data.comments) ? data.comments : [];
  const comments = rawComments.map((c) => ({
    id: c.id,
    message: c.message,
    createdAt: c.createdAt,
    authorId: c.publicUserId ?? null,
    authorName: c.publicUserName ?? null,
    reactionCount: c.reactionMap
      ? Object.values(c.reactionMap).reduce(
          (sum, users) => sum + Object.keys(users).length,
          0,
        )
      : 0,
  }));

  return { comments };
}

export async function getEventMedia(
  args: GetEventMediaInput,
): Promise<GetEventMediaOutput> {
  const data = await apiPost<{ media: RawMedia[] }>(
    args.token,
    args.userId !== null && args.userId !== undefined ? args.userId : '',
    'getEventMedia',
    { eventId: args.eventId },
  );

  const rawMedia = Array.isArray(data.media) ? data.media : [];
  const media = rawMedia.map((m) => ({
    id: m.id,
    type: m.type !== undefined && m.type !== null ? m.type : 'image',
    url:
      m.url !== undefined && m.url !== null
        ? m.url
        : m.upload?.url !== undefined && m.upload?.url !== null
          ? m.upload.url
          : null,
    uploadedAt: m.upload?.uploadedAt !== undefined ? m.upload.uploadedAt : null,
    uploaderId: m.uploaderId !== undefined ? m.uploaderId : null,
  }));

  return { media };
}

// ============================================================================
// People
// ============================================================================

export async function getUsers(args: GetUsersInput): Promise<GetUsersOutput> {
  const data = await apiPost<RawUser[]>(args.token, args.userId, 'getUsers', {
    ids: args.ids,
    includePartyStats: args.includePartyStats === true,
  });
  return { users: (Array.isArray(data) ? data : []).map(normalizeUser) };
}

export async function getMutuals(
  args: GetMutualsInput,
): Promise<GetMutualsOutput> {
  const paging = {
    cursor: args.cursor !== undefined ? args.cursor : null,
    maxResults: args.maxResults !== undefined ? args.maxResults : 100,
  };

  const rawData = await fetch(`${API_BASE}/getMutuals`, {
    method: 'POST',
    headers: makeHeaders(args.token),
    body: JSON.stringify({
      data: {
        params: { shouldRemoveEventData: false },
        paging,
        userId: args.userId,
      },
    }),
  });

  if (!rawData.ok) {
    const text = await rawData.text().catch(() => undefined);
    throwForStatus(rawData.status, text);
  }

  const json = (await rawData.json()) as {
    result: { data: RawMutual[]; paging?: { nextCursor?: string | null } };
  };
  const data = Array.isArray(json.result.data) ? json.result.data : [];
  const nextCursor =
    json.result.paging?.nextCursor !== undefined
      ? json.result.paging.nextCursor
      : null;

  return {
    mutuals: data.map((m) => ({
      userId: m.userId,
      name: m.name,
      sharedEventCount: m.sharedEventCount,
      isPastGuest: m.isPastGuest ?? null,
      sharedEvent: m.sharedEvent ?? null,
    })),
    nextCursor,
  };
}

export async function getContacts(
  args: GetContactsInput,
): Promise<GetContactsOutput> {
  const paging = {
    cursor: args.cursor !== undefined ? args.cursor : null,
    maxResults: args.maxResults !== undefined ? args.maxResults : 1000,
  };

  const rawData = await fetch(`${API_BASE}/getContacts`, {
    method: 'POST',
    headers: makeHeaders(args.token),
    body: JSON.stringify({
      data: {
        params: {},
        paging,
        userId: args.userId,
      },
    }),
  });

  if (!rawData.ok) {
    const text = await rawData.text().catch(() => undefined);
    throwForStatus(rawData.status, text);
  }

  const json = (await rawData.json()) as {
    result: { data: RawContact[]; paging?: { nextCursor?: string | null } };
  };
  const data = Array.isArray(json.result.data) ? json.result.data : [];
  const nextCursor =
    json.result.paging?.nextCursor !== undefined
      ? json.result.paging.nextCursor
      : null;

  return {
    contacts: data.map((c) => ({
      id: c.id,
      name: c.name,
      sharedEventCount: c.sharedEventCount,
      isPastGuest: c.isPastGuest ?? null,
      sharedEvent: c.sharedEvent ?? null,
    })),
    nextCursor,
  };
}
