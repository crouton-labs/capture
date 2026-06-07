/**
 * Instagram Library: Relationship Management
 *
 * followUser, unfollowUser, rejectFollowRequest, getUserFollowers, getUserFollowing
 */

import { ContractDrift, Unauthenticated, UpstreamError, throwForStatus } from '@vallum/_runtime';
import { buildHeaders, getAppId } from './helpers';
import type {
  FollowUserInput,
  FollowUserOutput,
  UnfollowUserInput,
  UnfollowUserOutput,
  RejectFollowRequestInput,
  RejectFollowRequestOutput,
  GetUserFollowersInput,
  GetUserFollowersOutput,
  GetUserFollowingInput,
  GetUserFollowingOutput,
} from './schemas-relationships';

// ============================================================================
// Shared
// ============================================================================

interface IGFriendshipStatus {
  following: boolean;
  followed_by: boolean;
  blocking: boolean;
  is_private: boolean;
  outgoing_request?: boolean;
  incoming_request?: boolean;
  is_bestie?: boolean;
  is_feed_favorite?: boolean;
  is_restricted?: boolean;
  muting?: boolean;
  is_eligible_to_subscribe?: boolean;
  subscribed?: boolean;
}

interface IGFriendshipResponse {
  friendship_status: IGFriendshipStatus;
  previous_following?: boolean;
  status: string;
}

function parseFriendshipResponse(
  data: IGFriendshipResponse,
  action: string,
  userId: string,
) {
  if (!data.friendship_status) {
    throw new ContractDrift(
      `${action}: unexpected response for userId ${userId}. Status: ${data.status}`,
    );
  }

  const fs = data.friendship_status;
  return {
    success: data.status === 'ok',
    friendshipStatus: {
      following: fs.following,
      followedBy: fs.followed_by,
      blocking: fs.blocking,
      isPrivate: fs.is_private,
      ...(fs.outgoing_request != null && {
        outgoingRequest: fs.outgoing_request,
      }),
      ...(fs.incoming_request != null && {
        incomingRequest: fs.incoming_request,
      }),
      ...(fs.is_bestie != null && { isBestie: fs.is_bestie }),
      ...(fs.is_feed_favorite != null && {
        isFeedFavorite: fs.is_feed_favorite,
      }),
      ...(fs.is_restricted != null && { isRestricted: fs.is_restricted }),
      ...(fs.muting != null && { muting: fs.muting }),
      ...(fs.is_eligible_to_subscribe != null && {
        isEligibleToSubscribe: fs.is_eligible_to_subscribe,
      }),
      ...(fs.subscribed != null && { subscribed: fs.subscribed }),
    },
    ...(data.previous_following != null && {
      previousFollowing: data.previous_following,
    }),
  };
}

// ============================================================================
// followUser
// ============================================================================

export async function followUser(
  params: FollowUserInput,
): Promise<FollowUserOutput> {
  const origin = window.location.origin;
  const containerModule = params.containerModule ?? 'profile';
  const body = new URLSearchParams({
    user_id: params.userId,
    container_module: containerModule,
    nav_chain: `${containerModule}:${containerModule}:1:via_cold_start`,
  });

  const resp = await fetch(
    `${origin}/api/v1/friendships/create/${params.userId}/`,
    {
      method: 'POST',
      credentials: 'include',
      headers: buildHeaders(params.csrf),
      body: body.toString(),
    },
  );

  if (!resp.ok) {
    const body = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, body);
  }

  const data = (await resp.json()) as IGFriendshipResponse;
  return parseFriendshipResponse(data, 'followUser', params.userId);
}

// ============================================================================
// unfollowUser
// ============================================================================

export async function unfollowUser(
  params: UnfollowUserInput,
): Promise<UnfollowUserOutput> {
  const origin = window.location.origin;
  const containerModule = params.containerModule ?? 'profile';
  const navChain =
    params.navChain ?? `${containerModule}:${containerModule}:1:via_cold_start`;
  const body = new URLSearchParams({
    user_id: params.userId,
    container_module: containerModule,
    nav_chain: navChain,
  });

  const resp = await fetch(
    `${origin}/api/v1/friendships/destroy/${params.userId}/`,
    {
      method: 'POST',
      credentials: 'include',
      headers: buildHeaders(params.csrf),
      body: body.toString(),
    },
  );

  if (!resp.ok) {
    const body = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, body);
  }

  const data = (await resp.json()) as IGFriendshipResponse;
  return parseFriendshipResponse(data, 'unfollowUser', params.userId);
}

// ============================================================================
// rejectFollowRequest
// ============================================================================

export async function rejectFollowRequest(
  params: RejectFollowRequestInput,
): Promise<RejectFollowRequestOutput> {
  const origin = window.location.origin;
  const body = new URLSearchParams({
    user_id: params.userId,
    container_module: 'follow_requests',
    nav_chain: 'follow_requests:follow_requests:1:via_cold_start',
  });

  const resp = await fetch(
    `${origin}/api/v1/friendships/ignore/${params.userId}/`,
    {
      method: 'POST',
      credentials: 'include',
      headers: buildHeaders(params.csrf),
      body: body.toString(),
    },
  );

  if (!resp.ok) {
    const body = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, body);
  }

  const data = (await resp.json()) as IGFriendshipResponse;
  return parseFriendshipResponse(data, 'rejectFollowRequest', params.userId);
}

// ============================================================================
// getUserFollowers
// ============================================================================

interface IGFollowListUser {
  pk?: string;
  pk_id?: string;
  username?: string;
  full_name?: string;
  is_private?: boolean;
  is_verified?: boolean;
  profile_pic_url?: string;
}

interface IGFollowListResponse {
  users?: IGFollowListUser[];
  has_more?: boolean;
  next_max_id?: string;
  page_size?: number;
  status?: string;
}

function parseFollowListUser(u: IGFollowListUser) {
  return {
    userId: u.pk ?? u.pk_id ?? '',
    username: u.username ?? '',
    fullName: u.full_name ?? '',
    isPrivate: Boolean(u.is_private),
    isVerified: Boolean(u.is_verified),
    profilePicUrl: u.profile_pic_url ?? '',
  };
}

export async function getUserFollowers(
  params: GetUserFollowersInput,
): Promise<GetUserFollowersOutput> {
  const origin = window.location.origin;
  const limit = params.limit ?? 50;
  const qs = new URLSearchParams({
    count: String(limit),
    search_surface: 'follow_list_page',
  });
  if (params.maxId) qs.set('max_id', params.maxId);

  const resp = await fetch(
    `${origin}/api/v1/friendships/${params.userId}/followers/?${qs}`,
    {
      method: 'GET',
      credentials: 'include',
      headers: {
        accept: '*/*',
        'x-csrftoken': params.csrf,
        'x-ig-app-id': getAppId(),
        'x-requested-with': 'XMLHttpRequest',
      },
    },
  );

  if (!resp.ok) {
    const body = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, body);
  }

  const ct = resp.headers.get('content-type') ?? '';
  if (ct.includes('text/html')) {
    throw new Unauthenticated(
      `getUserFollowers: Instagram returned HTML. Session may be expired — log in again at instagram.com.`,
    );
  }

  const data: IGFollowListResponse = await resp.json();
  if (data.status !== 'ok') {
    throw new UpstreamError(
      `getUserFollowers: API returned status "${data.status}" for user ${params.userId}.`,
    );
  }

  const users = (data.users ?? []).map(parseFollowListUser);
  return {
    users,
    totalCount: users.length,
    hasMore: Boolean(data.has_more),
    nextMaxId: data.next_max_id ?? null,
  };
}

// ============================================================================
// getUserFollowing
// ============================================================================

export async function getUserFollowing(
  params: GetUserFollowingInput,
): Promise<GetUserFollowingOutput> {
  const origin = window.location.origin;
  const limit = params.limit ?? 50;
  const qs = new URLSearchParams({
    count: String(limit),
  });
  if (params.maxId) qs.set('max_id', params.maxId);

  const resp = await fetch(
    `${origin}/api/v1/friendships/${params.userId}/following/?${qs}`,
    {
      method: 'GET',
      credentials: 'include',
      headers: {
        accept: '*/*',
        'x-csrftoken': params.csrf,
        'x-ig-app-id': getAppId(),
        'x-requested-with': 'XMLHttpRequest',
      },
    },
  );

  if (!resp.ok) {
    const body = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, body);
  }

  const ct = resp.headers.get('content-type') ?? '';
  if (ct.includes('text/html')) {
    throw new Unauthenticated(
      `getUserFollowing: Instagram returned HTML. Session may be expired — log in again at instagram.com.`,
    );
  }

  const data: IGFollowListResponse = await resp.json();
  if (data.status !== 'ok') {
    throw new UpstreamError(
      `getUserFollowing: API returned status "${data.status}" for user ${params.userId}.`,
    );
  }

  const users = (data.users ?? []).map(parseFollowListUser);
  return {
    users,
    totalCount: users.length,
    hasMore: Boolean(data.has_more),
    nextMaxId: data.next_max_id ?? null,
  };
}
