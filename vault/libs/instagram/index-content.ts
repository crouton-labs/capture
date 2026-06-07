/**
 * Instagram Library: Content Reads
 *
 * searchUsers, getPostDetail, getSavedPosts, getSuggestedUsers
 */

import { Validation, ContractDrift, NotFound, Unauthenticated, throwForStatus } from '@vallum/_runtime';
import { buildHeaders, graphqlQuery, getDtsgToken, computeJazoest } from './helpers';
import type {
  SearchUsersInput,
  SearchUsersOutput,
  GetPostDetailInput,
  GetPostDetailOutput,
  GetSavedPostsInput,
  GetSavedPostsOutput,
  GetSuggestedUsersInput,
  GetSuggestedUsersOutput,
  GetHashtagFeedInput,
  GetHashtagFeedOutput,
  GetLocationFeedInput,
  GetLocationFeedOutput,
  DiscoveryMedia,
} from './schemas-content';

// ============================================================================
// searchUsers
// ============================================================================

interface TopSearchUserItem {
  position?: number;
  user?: {
    pk?: string | number;
    username?: string;
    full_name?: string;
    profile_pic_url?: string;
    is_verified?: boolean;
    is_private?: boolean;
    follower_count?: number;
  };
}

interface TopSearchHashtagItem {
  position?: number;
  hashtag?: {
    id?: number;
    name?: string;
    media_count?: number;
  };
}

interface TopSearchPlaceItem {
  position?: number;
  place?: {
    location?: {
      pk?: string | number;
      name?: string;
      address?: string;
      lat?: number;
      lng?: number;
    };
    title?: string;
  };
}

interface IGTopSearchResponse {
  users?: TopSearchUserItem[];
  hashtags?: TopSearchHashtagItem[];
  places?: TopSearchPlaceItem[];
  status?: string;
}

export async function searchUsers(
  params: SearchUsersInput,
): Promise<SearchUsersOutput> {
  if (!params.query) throw new Validation('searchUsers: query is required');

  const origin = window.location.origin;
  const headers = buildHeaders(params.csrf);
  headers['content-type'] = 'application/json';

  const queryParams = new URLSearchParams({
    context: 'blended',
    query: params.query,
    include_reel: 'true',
  });

  const resp = await fetch(
    `${origin}/web/search/topsearch/?${queryParams.toString()}`,
    {
      method: 'GET',
      credentials: 'include',
      headers,
    },
  );

  if (!resp.ok) {
    const text = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, text);
  }

  const rawContentType = resp.headers.get('content-type');
  const contentType = rawContentType !== null ? rawContentType : '';
  if (contentType.includes('text/html')) {
    throw new Unauthenticated(
      'searchUsers: Instagram returned HTML instead of JSON. Auth tokens may be missing or invalid.',
    );
  }

  const data = (await resp.json()) as IGTopSearchResponse;

  const rawUsers = data.users !== undefined ? data.users : [];
  const users = rawUsers
    .filter((item) => item.user)
    .map((item) => {
      const u = item.user!;
      const pk = u.pk !== undefined ? u.pk : '';
      return {
        userId: String(pk),
        username: u.username !== undefined ? u.username : '',
        fullName: u.full_name !== undefined ? u.full_name : '',
        profilePicUrl: u.profile_pic_url !== undefined ? u.profile_pic_url : '',
        isVerified: Boolean(u.is_verified),
        isPrivate: Boolean(u.is_private),
        followerCount: u.follower_count !== undefined ? u.follower_count : 0,
      };
    });

  const rawHashtags = data.hashtags !== undefined ? data.hashtags : [];
  const hashtags = rawHashtags
    .filter((item) => item.hashtag)
    .map((item) => {
      const h = item.hashtag!;
      return {
        id: h.id !== undefined ? h.id : 0,
        name: h.name !== undefined ? h.name : '',
        mediaCount: h.media_count !== undefined ? h.media_count : 0,
      };
    });

  const rawPlaces = data.places !== undefined ? data.places : [];
  const places = rawPlaces
    .filter((item) => item.place?.location)
    .map((item) => {
      const loc = item.place!.location!;
      const pk = loc.pk !== undefined ? loc.pk : '';
      const placeName =
        loc.name !== undefined
          ? loc.name
          : item.place!.title !== undefined
            ? item.place!.title
            : '';
      return {
        id: String(pk),
        name: placeName,
        address: loc.address !== undefined ? loc.address : '',
        lat: loc.lat !== undefined ? loc.lat : null,
        lng: loc.lng !== undefined ? loc.lng : null,
      };
    });

  return { users, hashtags, places };
}

// ============================================================================
// getPostDetail
// ============================================================================

interface IGPostDetailResponse {
  data?: {
    xdt_shortcode_media?: {
      __typename?: string;
      id?: string;
      shortcode?: string;
      taken_at_timestamp?: number;
      owner?: {
        id?: string;
        username?: string;
        full_name?: string;
        profile_pic_url?: string;
        is_verified?: boolean;
        is_private?: boolean;
      };
      edge_media_to_caption?: {
        edges?: Array<{ node?: { text?: string } }>;
      };
      display_url?: string;
      is_video?: boolean;
      video_url?: string | null;
      edge_media_preview_like?: { count?: number };
      edge_media_to_parent_comment?: {
        count?: number;
        edges?: Array<{
          node?: {
            id?: string;
            text?: string;
            created_at?: number;
            owner?: { username?: string };
            edge_liked_by?: { count?: number };
          };
        }>;
      };
      edge_sidecar_to_children?: {
        edges?: Array<{
          node?: {
            display_url?: string;
          };
        }>;
      };
      location?: {
        name?: string;
      } | null;
      accessibility_caption?: string | null;
    };
  };
}

export async function getPostDetail(
  params: GetPostDetailInput,
): Promise<GetPostDetailOutput> {
  if (!params.shortcode)
    throw new Validation('getPostDetail: shortcode is required');

  const data = await graphqlQuery<IGPostDetailResponse>(
    params.csrf,
    '8845758582119845',
    'PolarisPostActionLoadPostQueryQuery',
    {
      shortcode: params.shortcode,
      fetch_comment_count: 40,
      parent_comment_count: 24,
      child_comment_count: 3,
      has_threaded_comments: true,
    },
  );

  const media = data?.data?.xdt_shortcode_media;
  if (!media) {
    throw new NotFound(
      `getPostDetail: post not found for shortcode "${params.shortcode}". Keys: ${JSON.stringify(Object.keys(data?.data || {}))}`,
    );
  }

  if (!media.id)
    throw new ContractDrift(
      `getPostDetail: media missing id for shortcode "${params.shortcode}"`,
    );
  if (!media.display_url)
    throw new ContractDrift(
      `getPostDetail: media missing display_url for shortcode "${params.shortcode}"`,
    );

  const owner = media.owner;
  if (!owner)
    throw new ContractDrift(
      `getPostDetail: media missing owner for shortcode "${params.shortcode}"`,
    );

  const captionEdges = media.edge_media_to_caption?.edges;
  const captionText =
    captionEdges &&
    captionEdges.length > 0 &&
    captionEdges[0].node?.text !== undefined
      ? captionEdges[0].node!.text!
      : null;

  const commentEdges =
    media.edge_media_to_parent_comment?.edges !== undefined
      ? media.edge_media_to_parent_comment.edges
      : [];
  const comments = commentEdges
    .filter((e) => e.node)
    .map((e) => {
      const n = e.node!;
      return {
        id: n.id !== undefined ? n.id : '',
        text: n.text !== undefined ? n.text : '',
        createdAt: n.created_at !== undefined ? n.created_at : 0,
        ownerUsername: n.owner?.username !== undefined ? n.owner.username : '',
        likeCount:
          n.edge_liked_by?.count !== undefined ? n.edge_liked_by.count : 0,
      };
    });

  const carouselEdges =
    media.edge_sidecar_to_children?.edges !== undefined
      ? media.edge_sidecar_to_children.edges
      : [];
  const carouselMediaUrls = carouselEdges
    .filter((e) => e.node?.display_url)
    .map((e) => e.node!.display_url!);

  return {
    postId: media.id,
    shortcode:
      media.shortcode !== undefined ? media.shortcode : params.shortcode,
    typename: media.__typename !== undefined ? media.__typename : 'GraphImage',
    owner: {
      userId: owner.id !== undefined ? owner.id : '',
      username: owner.username !== undefined ? owner.username : '',
      fullName: owner.full_name !== undefined ? owner.full_name : '',
      profilePicUrl:
        owner.profile_pic_url !== undefined ? owner.profile_pic_url : '',
      isVerified: Boolean(owner.is_verified),
      isPrivate: Boolean(owner.is_private),
    },
    captionText,
    displayUrl: media.display_url,
    isVideo: Boolean(media.is_video),
    videoUrl: media.video_url !== undefined ? media.video_url : null,
    likeCount:
      media.edge_media_preview_like?.count !== undefined
        ? media.edge_media_preview_like.count
        : 0,
    commentCount:
      media.edge_media_to_parent_comment?.count !== undefined
        ? media.edge_media_to_parent_comment.count
        : 0,
    timestamp:
      media.taken_at_timestamp !== undefined ? media.taken_at_timestamp : 0,
    locationName:
      media.location !== undefined &&
      media.location !== null &&
      media.location.name !== undefined
        ? media.location.name
        : null,
    accessibilityCaption:
      media.accessibility_caption !== undefined
        ? media.accessibility_caption
        : null,
    comments,
    carouselMediaUrls,
  };
}

// ============================================================================
// getSavedPosts
// ============================================================================

interface SavedMediaItem {
  pk?: string | number;
  id?: string;
  code?: string;
  caption?: { text?: string } | null;
  like_count?: number;
  comment_count?: number;
  taken_at?: number;
  media_type?: number;
  is_video?: boolean;
  image_versions2?: {
    candidates?: Array<{ url?: string; width?: number; height?: number }>;
  };
  user?: {
    pk?: string | number;
    username?: string;
    full_name?: string;
    profile_pic_url?: string;
    is_verified?: boolean;
    is_private?: boolean;
  };
}

interface SavedItemWrapper {
  media?: SavedMediaItem;
}

interface IGSavedFeedResponse {
  items?: SavedItemWrapper[];
  num_results?: number;
  more_available?: boolean;
  next_max_id?: string | null;
  status?: string;
}

export async function getSavedPosts(
  params: GetSavedPostsInput,
): Promise<GetSavedPostsOutput> {
  const origin = window.location.origin;
  const headers = buildHeaders(params.csrf);
  headers['content-type'] = 'application/json';

  const queryParams = new URLSearchParams({
    include_igtv_preview: 'false',
  });

  if (params.maxId) {
    queryParams.set('max_id', params.maxId);
  }

  const resp = await fetch(
    `${origin}/api/v1/feed/saved/posts/?${queryParams.toString()}`,
    {
      method: 'GET',
      credentials: 'include',
      headers,
    },
  );

  if (!resp.ok) {
    const text = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, text);
  }

  const rawContentType = resp.headers.get('content-type');
  const contentType = rawContentType !== null ? rawContentType : '';
  if (contentType.includes('text/html')) {
    throw new Unauthenticated(
      'getSavedPosts: Instagram returned HTML instead of JSON. Auth tokens may be missing or invalid.',
    );
  }

  const data = (await resp.json()) as IGSavedFeedResponse;

  if (!data.items && data.status !== 'ok') {
    throw new ContractDrift(
      `getSavedPosts: unexpected response. Keys: ${JSON.stringify(Object.keys(data))}`,
    );
  }

  const items = data.items !== undefined ? data.items : [];

  const posts = items
    .filter((item) => item.media)
    .map((item) => {
      const m = item.media!;
      const postId = m.pk !== undefined ? m.pk : m.id;
      if (!postId) throw new ContractDrift('getSavedPosts: saved post missing pk/id');

      const shortcode = m.code;
      if (!shortcode)
        throw new ContractDrift(`getSavedPosts: saved post ${postId} missing code`);

      const user = m.user;
      if (!user)
        throw new ContractDrift(`getSavedPosts: saved post ${postId} missing user`);

      const userId = user.pk !== undefined ? user.pk : '';

      const captionText =
        m.caption && m.caption.text !== undefined ? m.caption.text : null;
      const mediaType = m.media_type !== undefined ? m.media_type : 1;

      let thumbnailUrl: string | null = null;
      const candidates = m.image_versions2?.candidates;
      if (candidates && candidates.length > 0) {
        const url = candidates[0].url;
        thumbnailUrl = url !== undefined ? url : null;
      }

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
        likeCount: m.like_count !== undefined ? m.like_count : 0,
        commentCount: m.comment_count !== undefined ? m.comment_count : 0,
        timestamp: m.taken_at !== undefined ? m.taken_at : 0,
        mediaType,
        thumbnailUrl,
        isVideo: Boolean(
          m.is_video !== undefined ? m.is_video : mediaType === 2,
        ),
      };
    });

  const moreAvailable =
    data.more_available !== undefined ? data.more_available : false;
  const nextMaxId =
    data.next_max_id !== undefined && data.next_max_id !== null
      ? data.next_max_id
      : null;

  return {
    posts,
    totalCount: posts.length,
    hasMore: moreAvailable,
    nextMaxId,
  };
}

// ============================================================================
// getSuggestedUsers
// ============================================================================

interface AymlSuggestionUser {
  pk?: string | number;
  username?: string;
  full_name?: string;
  profile_pic_url?: string;
  is_verified?: boolean;
  is_private?: boolean;
}

interface AymlSuggestion {
  user?: AymlSuggestionUser;
  algorithm?: string;
  social_context?: string;
}

interface IGAymlResponse {
  more_available?: boolean;
  max_id?: string;
  suggested_users?: {
    suggestions?: AymlSuggestion[];
  };
  status?: string;
}

export async function getSuggestedUsers(
  params: GetSuggestedUsersInput,
): Promise<GetSuggestedUsersOutput> {
  const origin = window.location.origin;

  const dtsg = getDtsgToken();
  const jazoest = computeJazoest(dtsg);

  const body = new URLSearchParams({
    max_id: '[]',
    max_number_to_display: '30',
    module: 'discover_people',
    paginate: 'true',
    fb_dtsg: dtsg,
    jazoest,
  });

  const resp = await fetch(`${origin}/api/v1/discover/ayml/`, {
    method: 'POST',
    credentials: 'include',
    headers: buildHeaders(params.csrf),
    body: body.toString(),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, text);
  }

  const rawContentType = resp.headers.get('content-type');
  const contentType = rawContentType !== null ? rawContentType : '';
  if (contentType.includes('text/html')) {
    throw new Unauthenticated(
      'getSuggestedUsers: Instagram returned HTML instead of JSON. Auth tokens may be missing or invalid.',
    );
  }

  const data = (await resp.json()) as IGAymlResponse;

  const suggestions = data.suggested_users !== undefined ? data.suggested_users.suggestions : undefined;
  if (!suggestions) {
    throw new ContractDrift(
      `getSuggestedUsers: unexpected response shape. Keys found: ${JSON.stringify(Object.keys(data))}`,
    );
  }

  const users = suggestions
    .filter((s): s is AymlSuggestion & { user: AymlSuggestionUser } => s.user !== undefined)
    .map((s) => {
      const u = s.user;
      const pk = u.pk !== undefined ? u.pk : '';
      return {
        userId: String(pk),
        username: u.username !== undefined ? u.username : '',
        fullName: u.full_name !== undefined ? u.full_name : '',
        profilePicUrl: u.profile_pic_url !== undefined ? u.profile_pic_url : '',
        isVerified: Boolean(u.is_verified),
        isPrivate: Boolean(u.is_private),
      };
    });

  return {
    users,
    totalCount: users.length,
  };
}

// ============================================================================
// Discovery feeds — getHashtagFeed, getLocationFeed
//
// Both /api/v1/tags/{tag}/sections/ and /api/v1/locations/{id}/sections/ return
// the same shape: a `sections[]` array whose layout_content holds media items
// (full IG media objects, each carrying its author in `.user`). We flatten all
// section layouts into one post list, then page via next_max_id.
// ============================================================================

interface SectionMediaItem {
  pk?: string | number;
  id?: string;
  code?: string;
  caption?: { text?: string } | null;
  like_count?: number;
  comment_count?: number;
  taken_at?: number;
  media_type?: number;
  play_count?: number | null;
  view_count?: number | null;
  image_versions2?: { candidates?: Array<{ url?: string }> };
  user?: {
    pk?: string | number;
    username?: string;
    full_name?: string;
    is_verified?: boolean;
    is_private?: boolean;
  };
}

interface SectionMediaWrapper {
  media?: SectionMediaItem;
}

interface SectionLayoutContent {
  medias?: SectionMediaWrapper[];
  fill_items?: SectionMediaWrapper[];
  one_by_two_item?: { clips?: { items?: SectionMediaWrapper[] } };
  two_by_two_item?: { clips?: { items?: SectionMediaWrapper[] } };
}

interface FeedSection {
  layout_type?: string;
  layout_content?: SectionLayoutContent;
}

interface IGSectionsResponse {
  sections?: FeedSection[];
  more_available?: boolean;
  next_max_id?: string | null;
  status?: string;
}

/** Collect every media wrapper across the varied section layout shapes. */
function collectSectionMedia(sections: FeedSection[]): SectionMediaItem[] {
  const out: SectionMediaItem[] = [];
  for (const section of sections) {
    const lc = section.layout_content;
    if (!lc) continue;
    const buckets: Array<SectionMediaWrapper[] | undefined> = [
      lc.medias,
      lc.fill_items,
      lc.one_by_two_item?.clips?.items,
      lc.two_by_two_item?.clips?.items,
    ];
    for (const bucket of buckets) {
      if (!bucket) continue;
      for (const wrapper of bucket) {
        if (wrapper.media) out.push(wrapper.media);
      }
    }
  }
  return out;
}

function normalizeSectionMedia(m: SectionMediaItem): DiscoveryMedia {
  const postId = m.pk !== undefined ? String(m.pk) : m.id || '';
  if (!postId) throw new ContractDrift('discovery feed: media item missing pk/id');
  if (!m.code)
    throw new ContractDrift(`discovery feed: media ${postId} missing code`);

  const user = m.user;
  if (!user)
    throw new ContractDrift(`discovery feed: media ${postId} missing author (user)`);

  const mediaType = m.media_type !== undefined ? m.media_type : 1;
  const isVideo = mediaType === 2;
  const candidates = m.image_versions2?.candidates;
  const thumbnailUrl =
    candidates && candidates.length > 0 && candidates[0].url !== undefined
      ? candidates[0].url
      : '';

  // Reels report play_count; feed videos report view_count.
  const rawView =
    m.play_count !== undefined && m.play_count !== null
      ? m.play_count
      : m.view_count !== undefined
        ? m.view_count
        : null;

  return {
    postId,
    shortcode: m.code,
    author: {
      userId: user.pk !== undefined ? String(user.pk) : '',
      username: user.username !== undefined ? user.username : '',
      fullName: user.full_name !== undefined ? user.full_name : '',
      isVerified: Boolean(user.is_verified),
      isPrivate: Boolean(user.is_private),
    },
    captionText: m.caption && m.caption.text !== undefined ? m.caption.text : null,
    thumbnailUrl,
    mediaType,
    isVideo,
    likeCount: m.like_count !== undefined ? m.like_count : 0,
    commentCount: m.comment_count !== undefined ? m.comment_count : 0,
    viewCount: rawView,
    takenAt: m.taken_at !== undefined ? m.taken_at : 0,
  };
}

/** Shared POST to a /sections/ endpoint with the tab + pagination form body. */
async function fetchSectionsFeed(
  csrf: string,
  path: string,
  tab: string,
  maxId: string | undefined,
  fnName: string,
): Promise<IGSectionsResponse> {
  const origin = window.location.origin;
  const body = new URLSearchParams({ tab });
  if (maxId) {
    body.set('max_id', maxId);
    body.set('page', '1');
  }

  const resp = await fetch(`${origin}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: buildHeaders(csrf),
    body: body.toString(),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, text);
  }

  const rawContentType = resp.headers.get('content-type');
  const contentType = rawContentType !== null ? rawContentType : '';
  if (contentType.includes('text/html')) {
    throw new Unauthenticated(
      `${fnName}: Instagram returned HTML instead of JSON. Auth tokens may be missing or invalid.`,
    );
  }

  const data = (await resp.json()) as IGSectionsResponse;
  if (!data.sections && data.status !== 'ok') {
    throw new ContractDrift(
      `${fnName}: unexpected response. Keys: ${JSON.stringify(Object.keys(data))}`,
    );
  }
  return data;
}

export async function getHashtagFeed(
  params: GetHashtagFeedInput,
): Promise<GetHashtagFeedOutput> {
  if (!params.hashtag) throw new Validation('getHashtagFeed: hashtag is required');

  const tab = params.tab !== undefined ? params.tab : 'top';
  const tag = params.hashtag.replace(/^#/, '');
  const data = await fetchSectionsFeed(
    params.csrf,
    `/api/v1/tags/${encodeURIComponent(tag)}/sections/`,
    tab,
    params.maxId,
    'getHashtagFeed',
  );

  const posts = collectSectionMedia(data.sections || []).map(normalizeSectionMedia);
  const hasMore = data.more_available === true;
  const nextMaxId =
    data.next_max_id !== undefined && data.next_max_id !== null
      ? data.next_max_id
      : null;

  return { posts, totalCount: posts.length, hasMore, nextMaxId };
}

export async function getLocationFeed(
  params: GetLocationFeedInput,
): Promise<GetLocationFeedOutput> {
  if (!params.locationId)
    throw new Validation('getLocationFeed: locationId is required');

  const tab = params.tab !== undefined ? params.tab : 'ranked';
  const data = await fetchSectionsFeed(
    params.csrf,
    `/api/v1/locations/${encodeURIComponent(params.locationId)}/sections/`,
    tab,
    params.maxId,
    'getLocationFeed',
  );

  const posts = collectSectionMedia(data.sections || []).map(normalizeSectionMedia);
  const hasMore = data.more_available === true;
  const nextMaxId =
    data.next_max_id !== undefined && data.next_max_id !== null
      ? data.next_max_id
      : null;

  return { posts, totalCount: posts.length, hasMore, nextMaxId };
}
