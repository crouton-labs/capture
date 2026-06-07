/**
 * Instagram Library: Notifications & Social
 *
 * getPendingFollowRequests, acceptFollowRequest, getActivityFeed
 */

import { ContractDrift, Unauthenticated, throwForStatus } from '@vallum/_runtime';
import { buildHeaders } from './helpers';
import type {
  GetPendingFollowRequestsInput,
  GetPendingFollowRequestsOutput,
  AcceptFollowRequestInput,
  AcceptFollowRequestOutput,
  GetActivityFeedInput,
  GetActivityFeedOutput,
  ActivityFeedCounts,
  ActivityStory,
} from './schemas';

// ============================================================================
// getPendingFollowRequests
// ============================================================================

interface IGPendingUser {
  pk: string | number;
  username: string;
  full_name: string;
  profile_pic_url: string;
  is_verified: boolean;
  is_private: boolean;
}

interface IGSuggestedUser {
  pk: string | number;
  username: string;
  full_name: string;
  profile_pic_url: string;
  is_verified: boolean;
  is_private: boolean;
}

interface IGPendingRequestsResponse {
  users: IGPendingUser[];
  next_max_id?: string | null;
  big_list?: boolean;
  page_size?: number;
  follow_ranking_token?: string | null;
  truncate_follow_requests_at_index?: number | null;
  suggested_users?: {
    netego_type?: string;
    suggestions?: { user: IGSuggestedUser }[];
  } | null;
  status?: string;
}

export async function getPendingFollowRequests(
  params: GetPendingFollowRequestsInput,
): Promise<GetPendingFollowRequestsOutput> {
  const origin = window.location.origin;
  const url = new URL(`${origin}/api/v1/friendships/pending/`);
  if (params.maxId) {
    url.searchParams.set('max_id', params.maxId);
  }
  if (params.count !== undefined) {
    url.searchParams.set('count', String(params.count));
  }

  const resp = await fetch(url.toString(), {
    method: 'GET',
    credentials: 'include',
    headers: buildHeaders(params.csrf),
  });

  if (resp.redirected) {
    throw new Unauthenticated(
      `getPendingFollowRequests: redirected to ${resp.url}. Session is not authenticated; sessionid cookie may be missing or expired.`,
    );
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, text);
  }

  const contentType = resp.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    throw new Unauthenticated(
      'getPendingFollowRequests: received HTML instead of JSON. Auth tokens may be missing or invalid.',
    );
  }

  const data = (await resp.json()) as IGPendingRequestsResponse;

  if (!Array.isArray(data.users)) {
    throw new ContractDrift(
      `getPendingFollowRequests: unexpected response shape. Expected users array. Keys: ${JSON.stringify(Object.keys(data))}`,
    );
  }

  const requests = data.users.map((u) => ({
    userId: String(u.pk),
    username: u.username,
    fullName: u.full_name,
    profilePicUrl: u.profile_pic_url,
    isVerified: u.is_verified,
    isPrivate: u.is_private,
  }));

  const nextMaxId =
    typeof data.next_max_id === 'string' ? data.next_max_id : null;

  const suggestedUsers = (data.suggested_users?.suggestions ?? []).map((s) => ({
    userId: String(s.user.pk),
    username: s.user.username,
    fullName: s.user.full_name,
    profilePicUrl: s.user.profile_pic_url,
    isVerified: s.user.is_verified,
    isPrivate: s.user.is_private,
  }));

  return {
    requests,
    totalCount: requests.length,
    nextMaxId,
    bigList: data.big_list === true,
    pageSize:
      typeof data.page_size === 'number' ? data.page_size : requests.length,
    followRankingToken:
      typeof data.follow_ranking_token === 'string'
        ? data.follow_ranking_token
        : null,
    truncateFollowRequestsAtIndex:
      typeof data.truncate_follow_requests_at_index === 'number'
        ? data.truncate_follow_requests_at_index
        : null,
    suggestedUsers,
  };
}

// ============================================================================
// acceptFollowRequest
// ============================================================================

interface IGFriendshipStatus {
  following: boolean;
  followed_by: boolean;
  blocking: boolean;
  is_private: boolean;
}

interface IGFriendshipCreateResponse {
  friendship_status: IGFriendshipStatus;
  status: string;
}

// ============================================================================
// getActivityFeed
// ============================================================================

interface IGActivityStoryArgs {
  rich_text?: string;
  text?: string;
  destination?: string;
  icon_url?: string;
  timestamp?: number;
  tuuid?: string;
  aggregation_type?: string;
  content_version_id?: string;
  af_candidate_id?: string;
  logging_context?: {
    mentioned_user_ids?: string[];
    content_id?: string;
  };
}

interface IGActivityStory {
  story_type: number;
  notif_name: string;
  type: number;
  pk: string;
  ndid?: string;
  trace_id?: string;
  args: IGActivityStoryArgs;
  counts?: Record<string, unknown>;
  generation_source?: Record<string, unknown>;
}

interface IGActivityFeedCounts {
  usertags?: number;
  campaign_notification?: number;
  activity_feed_dot_badge_only?: number;
  promotional?: number;
  comment_likes?: number;
  new_posts?: number;
  shopping_notification?: number;
  comments?: number;
  activity_feed_dot_badge?: number;
  fundraiser?: number;
  relationships?: number;
  likes?: number;
  media_to_approve?: number;
  photos_of_you?: number;
  requests?: number;
}

interface IGActivityFeedResponse {
  counts?: IGActivityFeedCounts;
  last_checked?: number;
  priority_stories?: IGActivityStory[];
  new_stories?: IGActivityStory[];
  old_stories?: IGActivityStory[];
  continuation_token?: number;
  is_last_page?: boolean;
  partition?: Record<string, unknown>;
  subscription?: Record<string, unknown>;
  status?: string;
}

function mapActivityStory(raw: IGActivityStory): ActivityStory {
  const text =
    typeof raw.args.rich_text === 'string'
      ? raw.args.rich_text
      : typeof raw.args.text === 'string'
        ? raw.args.text
        : '';
  return {
    pk: String(raw.pk),
    notifName: raw.notif_name,
    type: raw.type,
    text,
    destination: typeof raw.args.destination === 'string' ? raw.args.destination : '',
    iconUrl: typeof raw.args.icon_url === 'string' ? raw.args.icon_url : '',
    timestamp: typeof raw.args.timestamp === 'number' ? raw.args.timestamp : 0,
    aggregationType: typeof raw.args.aggregation_type === 'string' ? raw.args.aggregation_type : '',
  };
}

export async function getActivityFeed(
  params: GetActivityFeedInput,
): Promise<GetActivityFeedOutput> {
  const csrf: string = params.csrf;

  const origin = window.location.origin;
  const endpoint = `${origin}/api/v1/news/inbox/`;
  const maxPages = typeof params.maxPages === 'number' ? params.maxPages : 10;

  let allStories: ActivityStory[] = [];
  let lastCounts: ActivityFeedCounts | null = null;
  let continuationToken: number | null = null;
  let isLastPage = false;

  for (let page = 0; page < maxPages; page++) {
    const body = continuationToken != null ? `max_id=${continuationToken}` : '';

    const resp = await fetch(endpoint, {
      method: 'POST',
      credentials: 'include',
      headers: buildHeaders(csrf),
      body,
    });

    if (resp.redirected) {
      throw new Unauthenticated(
        `getActivityFeed: redirected to ${resp.url}. Session is not authenticated; sessionid cookie may be missing or expired.`,
      );
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => undefined);
      throwForStatus(
        resp.status,
        `getActivityFeed: HTTP ${resp.status} from ${window.location.href}. Body: ${text?.slice(0, 500)}`,
      );
    }

    const contentType = resp.headers.get('content-type') ?? '';
    if (contentType.includes('text/html')) {
      throw new Unauthenticated(
        'getActivityFeed: received HTML instead of JSON. Auth tokens may be missing or invalid.',
      );
    }

    const data = (await resp.json()) as IGActivityFeedResponse;

    const expectedKeys = ['new_stories', 'old_stories', 'counts'] as const;
    const missingKeys = expectedKeys.filter((k) => !(k in data));
    if (missingKeys.length > 0) {
      throw new ContractDrift(
        `getActivityFeed: unexpected response shape. Missing keys: ${JSON.stringify(missingKeys)}. Keys found: ${JSON.stringify(Object.keys(data))}`,
      );
    }

    if (page === 0) {
      const raw: IGActivityFeedCounts =
        data.counts !== undefined && typeof data.counts === 'object'
          ? data.counts
          : {};
      lastCounts = {
        usertags: typeof raw.usertags === 'number' ? raw.usertags : 0,
        campaign_notification: typeof raw.campaign_notification === 'number' ? raw.campaign_notification : 0,
        activity_feed_dot_badge_only: typeof raw.activity_feed_dot_badge_only === 'number' ? raw.activity_feed_dot_badge_only : 0,
        promotional: typeof raw.promotional === 'number' ? raw.promotional : 0,
        comment_likes: typeof raw.comment_likes === 'number' ? raw.comment_likes : 0,
        new_posts: typeof raw.new_posts === 'number' ? raw.new_posts : 0,
        shopping_notification: typeof raw.shopping_notification === 'number' ? raw.shopping_notification : 0,
        comments: typeof raw.comments === 'number' ? raw.comments : 0,
        activity_feed_dot_badge: typeof raw.activity_feed_dot_badge === 'number' ? raw.activity_feed_dot_badge : 0,
        fundraiser: typeof raw.fundraiser === 'number' ? raw.fundraiser : 0,
        relationships: typeof raw.relationships === 'number' ? raw.relationships : 0,
        likes: typeof raw.likes === 'number' ? raw.likes : 0,
        media_to_approve: typeof raw.media_to_approve === 'number' ? raw.media_to_approve : 0,
        photos_of_you: typeof raw.photos_of_you === 'number' ? raw.photos_of_you : 0,
        requests: typeof raw.requests === 'number' ? raw.requests : 0,
      };
    }

    const newStories = Array.isArray(data.new_stories) ? data.new_stories : [];
    const oldStories = Array.isArray(data.old_stories) ? data.old_stories : [];
    const pageStories = [...newStories, ...oldStories].map(mapActivityStory);
    allStories = allStories.concat(pageStories);

    continuationToken =
      typeof data.continuation_token === 'number'
        ? data.continuation_token
        : null;
    isLastPage = data.is_last_page === true;

    if (isLastPage || continuationToken == null) break;
  }

  if (lastCounts == null) {
    throw new ContractDrift(
      'getActivityFeed: no pages were fetched or counts were absent in all pages.',
    );
  }

  return {
    counts: lastCounts,
    stories: allStories,
    continuationToken,
    isLastPage,
  };
}

// ============================================================================
// acceptFollowRequest
// ============================================================================

export async function acceptFollowRequest(
  params: AcceptFollowRequestInput,
): Promise<AcceptFollowRequestOutput> {
  const origin = window.location.origin;
  const bodyParams: Record<string, string> = {
    user_id: params.userId,
    container_module: 'follow_requests',
    nav_chain: 'follow_requests:follow_requests:1:via_cold_start',
  };
  if (params.hasSeenUkOsaPrompt !== undefined) {
    bodyParams.has_seen_uk_osa_prompt = params.hasSeenUkOsaPrompt
      ? 'true'
      : 'false';
  }
  const body = new URLSearchParams(bodyParams);

  const resp = await fetch(
    `${origin}/api/v1/friendships/approve/${params.userId}/`,
    {
      method: 'POST',
      credentials: 'include',
      headers: buildHeaders(params.csrf),
      body: body.toString(),
    },
  );

  if (!resp.ok) {
    const text = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, text);
  }

  const contentType = resp.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    throw new Unauthenticated(
      'acceptFollowRequest: received HTML instead of JSON. Auth tokens may be missing or invalid.',
    );
  }

  const data = (await resp.json()) as IGFriendshipCreateResponse;

  if (!data.friendship_status) {
    throw new ContractDrift(
      `acceptFollowRequest: unexpected response. Status: ${data.status}`,
    );
  }

  return {
    success: data.status === 'ok',
    friendshipStatus: {
      following: data.friendship_status.following,
      followedBy: data.friendship_status.followed_by,
      blocking: data.friendship_status.blocking,
      isPrivate: data.friendship_status.is_private,
    },
  };
}
