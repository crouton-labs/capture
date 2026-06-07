/**
 * Instagram Library: Feed & Explore
 *
 * getFeed, getExplore
 */

import { ContractDrift, Unauthenticated, UpstreamError, throwForStatus } from '@vallum/_runtime';
import { getCookie, buildHeaders, graphqlQuery } from './helpers';
import type {
  GetFeedInput,
  GetFeedOutput,
  GetExploreInput,
  GetExploreOutput,
} from './schemas';

// ============================================================================
// getFeed
// ============================================================================

interface FeedMediaCandidate {
  url?: string;
  width?: number;
  height?: number;
}

interface FeedMediaItem {
  pk?: string;
  id?: string;
  code?: string;
  caption?: { text?: string } | null;
  like_count?: number;
  comment_count?: number;
  taken_at?: number;
  media_type?: number;
  has_audio?: boolean | null;
  is_dash_eligible?: boolean | null;
  video_versions?: Array<{
    url?: string;
    width?: number;
    height?: number;
  }> | null;
  video_dash_manifest?: string | null;
  image_versions2?: {
    candidates?: FeedMediaCandidate[];
  };
  carousel_media_count?: number | null;
  product_type?: string | null;
  view_count?: number | null;
  user?: {
    pk?: string | number;
    id?: string;
    username?: string;
    full_name?: string;
    profile_pic_url?: string;
    is_verified?: boolean;
    is_private?: boolean;
  };
}

interface FeedEdgeNode {
  media?: FeedMediaItem | null;
  ad?: unknown;
  suggested_users?: unknown;
  explore_story?: { media?: FeedMediaItem | null } | null;
  end_of_feed_demarcator?: unknown;
  stories_netego?: unknown;
}

interface IGFeedResponse {
  errors?: Array<{ message?: string; severity?: string }>;
  data?: {
    xdt_api__v1__feed__timeline__connection?: {
      edges?: Array<{ node?: FeedEdgeNode }>;
      page_info?: { end_cursor?: string; has_next_page?: boolean };
    };
  } | null;
}

/** Parse video duration from DASH manifest XML's mediaPresentationDuration attribute (ISO 8601 PT...S) */
function parseDashDuration(manifest: string): number | null {
  const match = manifest.match(/mediaPresentationDuration="PT([0-9.]+)S"/);
  if (match) return parseFloat(match[1]);
  return null;
}

function extractThumbnailUrl(media: FeedMediaItem): string | null {
  const candidates = media.image_versions2?.candidates;
  if (candidates && candidates.length > 0) {
    const url = candidates[0].url;
    return url !== undefined ? url : null;
  }
  return null;
}

function mapFeedPost(media: FeedMediaItem) {
  const postId = media.pk !== undefined ? media.pk : media.id;
  if (!postId) throw new ContractDrift('Feed post missing id/pk field');

  const shortcode = media.code;
  if (!shortcode) throw new ContractDrift(`Feed post ${postId} missing code field`);

  const user = media.user;
  if (!user) throw new ContractDrift(`Feed post ${postId} missing user field`);

  const userId = user.pk !== undefined ? user.pk : user.id;
  if (!userId) throw new ContractDrift(`Feed post ${postId} missing user.pk/user.id`);

  const captionText =
    media.caption && media.caption.text !== undefined
      ? media.caption.text
      : null;

  const likeCount = media.like_count !== undefined ? media.like_count : 0;
  const commentCount =
    media.comment_count !== undefined ? media.comment_count : 0;
  const timestamp = media.taken_at !== undefined ? media.taken_at : 0;
  const mediaType = media.media_type !== undefined ? media.media_type : 1;

  const isVideo = mediaType === 2 || Boolean(media.is_dash_eligible);

  return {
    postId: String(postId),
    shortcode,
    author: {
      userId: String(userId),
      username: user.username !== undefined ? user.username : '',
      fullName: user.full_name !== undefined ? user.full_name : '',
      profilePicUrl:
        user.profile_pic_url !== undefined ? user.profile_pic_url : '',
      isVerified: Boolean(user.is_verified),
      isPrivate: Boolean(user.is_private),
    },
    captionText,
    likeCount,
    commentCount,
    timestamp,
    mediaType,
    thumbnailUrl: extractThumbnailUrl(media),
    isVideo,
    videoDuration:
      isVideo && media.video_dash_manifest
        ? parseDashDuration(media.video_dash_manifest)
        : null,
  };
}

export async function getFeed(params: GetFeedInput): Promise<GetFeedOutput> {
  const first = params.first !== undefined ? params.first : 12;
  const after = params.after !== undefined ? params.after : null;
  const variant = params.variant !== undefined ? params.variant : 'home';

  // Device ID for the feed data object; use stored device ID or generate UUID
  let deviceId = '';
  try {
    const stored = localStorage.getItem('chatd-deviceid');
    if (stored !== null) deviceId = stored;
  } catch {
    /* pass */
  }
  if (!deviceId) {
    const mid = getCookie('mid');
    deviceId = mid !== null ? mid : crypto.randomUUID();
  }

  const feedData: Record<string, string> = {
    device_id: deviceId,
    is_async_ads_double_request: '0',
    is_async_ads_in_headload_enabled: '0',
    is_async_ads_rti: '0',
    rti_delivery_backend: '0',
  };

  if (params.feedViewInfo !== undefined) {
    feedData.feed_view_info = params.feedViewInfo;
  }

  if (params.paginationSource !== undefined) {
    feedData.pagination_source = params.paginationSource;
  }

  const data = await graphqlQuery<IGFeedResponse>(
    params.csrf,
    '25856142194013261',
    'PolarisFeedTimelineRootV2Query',
    {
      after,
      before: null,
      data: feedData,
      first,
      last: null,
      variant,
    },
  );

  if (data?.errors && data.errors.length > 0) {
    const msgs = data.errors.map((e) => e.message || 'unknown').join('; ');
    throw new UpstreamError(
      `getFeed: GraphQL error from Instagram API: ${msgs}. ${after ? 'The cursor may be invalid or expired; request the feed without a cursor to get a fresh page.' : ''}`,
    );
  }

  const connection = data?.data?.xdt_api__v1__feed__timeline__connection;
  if (!connection) {
    throw new ContractDrift(
      `getFeed: failed to parse feed response. Expected data.xdt_api__v1__feed__timeline__connection. Keys found: ${JSON.stringify(Object.keys(data?.data ?? {}))}`,
    );
  }

  const edges = connection.edges !== undefined ? connection.edges : [];
  const pageInfo = connection.page_info;

  // The home feed interleaves units: a post can be a direct `node.media` OR a
  // recommended post nested under `node.explore_story.media` (the rest —
  // ad/suggested_users/stories_netego — carry no media). Accounts that follow
  // few people get an all-recommendations feed, so reading only `node.media`
  // returned ZERO posts. Pull from both.
  const posts = edges
    .map((edge) => edge.node?.media ?? edge.node?.explore_story?.media)
    .filter((media): media is FeedMediaItem => media != null)
    .map(mapFeedPost);

  const endCursor = pageInfo?.end_cursor;

  return {
    posts,
    totalCount: posts.length,
    hasMore: Boolean(pageInfo?.has_next_page),
    cursor: endCursor !== undefined ? endCursor : null,
  };
}

// ============================================================================
// getExplore
// ============================================================================

interface ExploreMediaItem {
  pk?: string;
  id?: string;
  code?: string;
  shortcode?: string;
  caption?: { text?: string } | null;
  like_count?: number;
  comment_count?: number;
  taken_at?: number;
  media_type?: number;
  is_video?: boolean | null;
  video_duration?: number | null;
  image_versions2?: { candidates?: FeedMediaCandidate[] };
  thumbnail_url?: string;
  user?: {
    pk?: string | number;
    id?: string;
    username?: string;
    full_name?: string;
    profile_pic_url?: string;
    is_verified?: boolean;
    is_private?: boolean;
  };
}

interface ExploreMediaWrapper {
  media?: ExploreMediaItem;
}

interface ExploreClipsContainer {
  items?: Array<{ media?: ExploreMediaItem }>;
}

interface ExploreSectionalItem {
  layout_content?: {
    medias?: ExploreMediaWrapper[];
    fill_items?: ExploreMediaWrapper[];
    one_by_two_item?: { clips?: ExploreClipsContainer };
  };
}

interface IGExploreCluster {
  id?: string;
  title?: string;
  type?: string;
  name?: string;
  can_mute?: boolean;
  is_muted?: boolean;
}

interface IGExploreResponse {
  sectional_items?: ExploreSectionalItem[];
  items?: ExploreMediaWrapper[];
  more_available?: boolean;
  next_max_id?: string | null;
  max_id?: string | null;
  session_paging_token?: string | null;
  auto_load_more_enabled?: boolean;
  rank_token?: string | null;
  clusters?: IGExploreCluster[];
}

function mapExplorePost(item: ExploreMediaItem) {
  const postId = item.pk !== undefined ? item.pk : item.id;
  if (!postId) throw new ContractDrift('Explore post missing id/pk field');

  const shortcode = item.code !== undefined ? item.code : item.shortcode;
  if (!shortcode)
    throw new ContractDrift(`Explore post ${postId} missing code/shortcode`);

  const user = item.user;
  if (!user) throw new ContractDrift(`Explore post ${postId} missing user field`);

  const userId = user.pk !== undefined ? user.pk : user.id;
  if (!userId)
    throw new ContractDrift(`Explore post ${postId} missing user.pk/user.id`);

  const candidates = item.image_versions2?.candidates;
  let thumbnailUrl: string | null = null;
  if (candidates && candidates.length > 0) {
    const url = candidates[0].url;
    thumbnailUrl = url !== undefined ? url : null;
  } else if (item.thumbnail_url !== undefined) {
    thumbnailUrl = item.thumbnail_url;
  }

  const captionText =
    item.caption && item.caption.text !== undefined ? item.caption.text : null;

  const mediaType = item.media_type !== undefined ? item.media_type : 1;

  const videoDuration =
    item.video_duration !== undefined && item.video_duration !== null
      ? item.video_duration
      : null;

  return {
    postId: String(postId),
    shortcode,
    author: {
      userId: String(userId),
      username: user.username !== undefined ? user.username : '',
      fullName: user.full_name !== undefined ? user.full_name : '',
      profilePicUrl:
        user.profile_pic_url !== undefined ? user.profile_pic_url : '',
      isVerified: Boolean(user.is_verified),
      isPrivate: Boolean(user.is_private),
    },
    captionText,
    likeCount: item.like_count !== undefined ? item.like_count : 0,
    commentCount: item.comment_count !== undefined ? item.comment_count : 0,
    timestamp: item.taken_at !== undefined ? item.taken_at : 0,
    mediaType,
    thumbnailUrl,
    isVideo: Boolean(item.is_video != null ? item.is_video : mediaType === 2),
    videoDuration,
  };
}

export async function getExplore(
  params: GetExploreInput,
): Promise<GetExploreOutput> {
  const origin = window.location.origin;

  const isNonPersonalized = params.isNonPersonalizedExplore === true;

  const queryParams = new URLSearchParams({
    module: params.module !== undefined ? params.module : 'explore_popular',
    is_prefetch: params.isPrefetch === true ? 'true' : 'false',
    is_nonpersonalized_explore: isNonPersonalized ? 'true' : 'false',
    include_fixed_destinations:
      params.includeFixedDestinations === false ? 'false' : 'true',
    omit_cover_media: params.omitCoverMedia === true ? 'true' : 'false',
  });

  if (params.maxId) {
    queryParams.set('max_id', params.maxId);
  }

  if (params.sessionId !== undefined) {
    queryParams.set('session_id', params.sessionId);
  }

  if (params.surfaceParam !== undefined) {
    queryParams.set('surface_param', params.surfaceParam);
  }

  if (params.topicClusterId !== undefined) {
    queryParams.set('topic_cluster_id', params.topicClusterId);
  }

  if (params.sessionPagingToken !== undefined) {
    queryParams.set('session_paging_token', params.sessionPagingToken);
  }

  const headers = buildHeaders(params.csrf);
  headers['content-type'] = 'application/json';

  const resp = await fetch(
    `${origin}/api/v1/discover/web/explore_grid/?${queryParams.toString()}`,
    {
      method: 'GET',
      credentials: 'include',
      headers,
    },
  );

  if (!resp.ok) {
    const body = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, body);
  }

  const rawContentType = resp.headers.get('content-type');
  const contentType = rawContentType !== null ? rawContentType : '';
  if (contentType.includes('text/html')) {
    throw new Unauthenticated(
      `getExplore: returned HTML instead of JSON. Auth tokens may be missing or invalid.`,
    );
  }

  const data = (await resp.json()) as IGExploreResponse;

  const mediaItems: ExploreMediaItem[] = [];

  if (data.sectional_items && data.sectional_items.length > 0) {
    for (const section of data.sectional_items) {
      const lc = section.layout_content;
      if (!lc) continue;
      // Extract from medias array
      if (lc.medias) {
        for (const wrapper of lc.medias) {
          if (wrapper.media) mediaItems.push(wrapper.media);
        }
      }
      // Extract from fill_items array
      if (lc.fill_items) {
        for (const wrapper of lc.fill_items) {
          if (wrapper.media) mediaItems.push(wrapper.media);
        }
      }
      // Extract clips from one_by_two_item (Reels)
      const clipItems = lc.one_by_two_item?.clips?.items;
      if (clipItems) {
        for (const clip of clipItems) {
          if (clip.media) mediaItems.push(clip.media);
        }
      }
    }
  } else if (data.items && data.items.length > 0) {
    for (const wrapper of data.items) {
      if (wrapper.media) mediaItems.push(wrapper.media);
    }
  } else if (data.sectional_items === undefined && data.items === undefined) {
    throw new ContractDrift(
      `getExplore: failed to parse response. Keys found: ${JSON.stringify(Object.keys(data))}`,
    );
  }

  const posts = mediaItems.map(mapExplorePost);

  const moreAvailable =
    data.more_available !== undefined
      ? data.more_available
      : Boolean(data.auto_load_more_enabled);

  // max_id is the actual pagination cursor (long base64 string);
  // next_max_id is just a page counter ("0", "1", ...) and not usable for pagination
  const nextMaxId =
    data.max_id !== undefined && data.max_id !== null ? data.max_id : null;

  const sessionPagingToken =
    data.session_paging_token !== undefined &&
    data.session_paging_token !== null
      ? data.session_paging_token
      : null;

  const rankToken =
    data.rank_token !== undefined && data.rank_token !== null
      ? data.rank_token
      : null;

  const clusters =
    data.clusters !== undefined && data.clusters !== null
      ? data.clusters.map((c) => ({
          id: c.id !== undefined ? c.id : '',
          title: c.title !== undefined ? c.title : '',
          type: c.type !== undefined ? c.type : '',
          name: c.name !== undefined ? c.name : '',
          canMute: Boolean(c.can_mute),
          isMuted: Boolean(c.is_muted),
        }))
      : [];

  return {
    posts,
    totalCount: posts.length,
    hasMore: moreAvailable,
    nextMaxId,
    sessionPagingToken,
    rankToken,
    clusters,
  };
}
