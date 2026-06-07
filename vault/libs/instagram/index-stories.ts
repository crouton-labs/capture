/**
 * Instagram Library: Stories
 *
 * getStoriesTray, getHighlights, getStoryArchive
 */

import { Unauthenticated, UpstreamError, throwForStatus } from '@vallum/_runtime';
import { getAppId } from './helpers';
import type {
  GetStoriesTrayInput,
  GetStoriesTrayOutput,
  GetHighlightsInput,
  GetHighlightsOutput,
  GetStoryArchiveInput,
  GetStoryArchiveOutput,
} from './schemas';

// ============================================================================
// getStoriesTray
// ============================================================================

interface IGReelsTrayUser {
  pk?: string | number;
  username?: string;
  full_name?: string;
  profile_pic_url?: string;
  is_verified?: boolean;
  is_private?: boolean;
}

interface IGReelsTrayItem {
  id?: string;
  latest_reel_media?: number;
  expiring_at?: number;
  seen?: number | null;
  user?: IGReelsTrayUser;
  media_count?: number;
  media_ids?: string[];
  reel_type?: string;
  muted?: boolean;
  has_besties_media?: boolean;
  has_video?: boolean;
  can_reply?: boolean;
  can_reshare?: boolean;
}

interface IGReelsTrayResponse {
  tray?: IGReelsTrayItem[];
  story_ranking_token?: string;
  status?: string;
}

export async function getStoriesTray(
  params: GetStoriesTrayInput,
): Promise<GetStoriesTrayOutput> {
  const csrf = params.csrf;
  const origin = window.location.origin;

  const url = new URL(`${origin}/api/v1/feed/reels_tray/`);
  if (params.reason) {
    url.searchParams.set('reason', params.reason);
  }
  if (typeof params.pageSize === 'number') {
    url.searchParams.set('page_size', String(params.pageSize));
  }

  const resp = await fetch(url.toString(), {
    method: 'GET',
    credentials: 'include',
    headers: {
      accept: '*/*',
      'x-csrftoken': csrf,
      'x-ig-app-id': getAppId(),
      'x-requested-with': 'XMLHttpRequest',
    },
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, text);
  }

  const data: IGReelsTrayResponse = await resp.json();
  const rawTray = data.tray ? data.tray : [];

  const stories = rawTray
    .map((item) => {
      const user = item.user;
      if (!user?.username) return null;

      const userId = user.pk !== undefined ? String(user.pk) : item.id;
      if (!userId) return null;

      const latestReelMedia =
        typeof item.latest_reel_media === 'number' ? item.latest_reel_media : 0;
      const seen = typeof item.seen === 'number' ? item.seen : null;

      return {
        id: item.id ? item.id : userId,
        userId,
        username: user.username,
        fullName: user.full_name ? user.full_name : '',
        profilePicUrl: user.profile_pic_url ? user.profile_pic_url : '',
        isVerified: user.is_verified === true,
        isPrivate: user.is_private === true,
        latestReelMedia,
        expiringAt: typeof item.expiring_at === 'number' ? item.expiring_at : 0,
        seen,
        hasUnseenStories: seen === null || seen < latestReelMedia,
        mediaCount: typeof item.media_count === 'number' ? item.media_count : 0,
        mediaIds: Array.isArray(item.media_ids)
          ? item.media_ids.map(String)
          : [],
        reelType: item.reel_type ? item.reel_type : 'user_reel',
        muted: item.muted === true,
        hasBestiesMedia: item.has_besties_media === true,
        hasVideo: item.has_video === true,
        canReply: item.can_reply === true,
        canReshare: item.can_reshare === true,
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  return {
    stories,
    totalCount: stories.length,
    storyRankingToken:
      typeof data.story_ranking_token === 'string'
        ? data.story_ranking_token
        : null,
  };
}

// ============================================================================
// getHighlights
// ============================================================================

interface IGHighlightNode {
  __typename?: string;
  id?: string;
  title?: string;
  cover_media?: {
    thumbnail_src?: string;
  } | null;
  cover_media_cropped_thumbnail?: {
    url?: string;
  } | null;
  owner?: {
    id?: string;
    username?: string;
    profile_pic_url?: string;
  } | null;
}

interface IGHighlightsGraphQLResponse {
  data?: {
    user?: {
      edge_highlight_reels?: {
        edges?: Array<{ node?: IGHighlightNode }>;
      };
    };
  };
}

export async function getHighlights(
  params: GetHighlightsInput,
): Promise<GetHighlightsOutput> {
  const csrf = params.csrf;
  const origin = window.location.origin;

  const url = new URL(`${origin}/graphql/query/`);
  url.searchParams.set('query_id', '9957820854288654');
  url.searchParams.set('user_id', params.userId);
  url.searchParams.set('include_chaining', 'false');
  url.searchParams.set('include_reel', 'false');
  url.searchParams.set('include_suggested_users', 'false');
  url.searchParams.set('include_logged_out_extras', 'false');
  url.searchParams.set('include_live_status', 'false');
  url.searchParams.set('include_highlight_reels', 'true');

  const resp = await fetch(url.toString(), {
    method: 'GET',
    credentials: 'include',
    headers: {
      accept: '*/*',
      'x-csrftoken': csrf,
      'x-ig-app-id': getAppId(),
      'x-requested-with': 'XMLHttpRequest',
    },
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, text);
  }

  const contentType = resp.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    throw new Unauthenticated('getHighlights: Instagram returned HTML instead of JSON. Auth tokens may be invalid.');
  }

  const data: IGHighlightsGraphQLResponse = await resp.json();
  const edges = data?.data?.user?.edge_highlight_reels?.edges || [];

  const highlights = edges
    .map((edge) => {
      const node = edge.node;
      if (!node?.id) return null;

      const coverMedia = node.cover_media_cropped_thumbnail?.url
        ? { thumbnailSrc: node.cover_media_cropped_thumbnail.url }
        : node.cover_media?.thumbnail_src
          ? { thumbnailSrc: node.cover_media.thumbnail_src }
          : null;

      return {
        id: node.id,
        title: node.title ? node.title : '',
        coverMedia,
      };
    })
    .filter((h): h is NonNullable<typeof h> => h !== null);

  return {
    highlights,
    totalCount: highlights.length,
  };
}

// ============================================================================
// getStoryArchive
// ============================================================================

interface IGArchiveItem {
  id?: string;
  media_type?: number;
  image_versions2?: {
    candidates?: Array<{
      url?: string;
      width?: number;
      height?: number;
    }>;
  };
  taken_at?: number;
  caption?: { text?: string } | null;
}

interface IGStoryArchiveResponse {
  num_results?: number | null;
  max_id?: string | null;
  more_available?: boolean | null;
  reel_auto_archive?: string;
  items?: IGArchiveItem[];
  status?: string;
}

export async function getStoryArchive(
  params: GetStoryArchiveInput,
): Promise<GetStoryArchiveOutput> {
  const csrf = params.csrf;
  const origin = window.location.origin;
  const timezoneOffset =
    typeof params.timezoneOffset === 'number' ? params.timezoneOffset : -25200;

  const url = new URL(`${origin}/api/v1/archive/reel/day_shells/`);
  url.searchParams.set('timezone_offset', String(timezoneOffset));
  if (params.nextMaxId) {
    url.searchParams.set('max_id', params.nextMaxId);
  }
  if (params.includeCover) {
    url.searchParams.set('include_cover', '1');
  }

  const resp = await fetch(url.toString(), {
    method: 'GET',
    credentials: 'include',
    headers: {
      accept: '*/*',
      'x-csrftoken': csrf,
      'x-ig-app-id': getAppId(),
      'x-requested-with': 'XMLHttpRequest',
    },
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, text);
  }

  const contentType = resp.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    // The /api/v1/archive/reel/day_shells/ endpoint now serves the SPA shell
    // (HTML) for authenticated requests — it appears deprecated for web. The
    // story archive UI is no longer URL-addressable, so the current call site
    // can't be re-captured without the in-app archive view. Needs a live
    // recapture from an account that has archived stories. (verify-lib flags this.)
    throw new UpstreamError(
      `getStoryArchive: endpoint /api/v1/archive/reel/day_shells/ returned HTML, not JSON (likely deprecated for web) at ${window.location.href}. Needs re-capture of the current story-archive endpoint.`,
    );
  }

  const data: IGStoryArchiveResponse = await resp.json();

  const rawItems = Array.isArray(data.items) ? data.items : [];

  const items = rawItems
    .map((item) => {
      if (!item.id) return null;
      const candidates = item.image_versions2?.candidates;
      const thumbnailUrl =
        Array.isArray(candidates) && candidates.length > 0
          ? candidates[0].url || ''
          : '';
      return {
        id: item.id,
        mediaType: typeof item.media_type === 'number' ? item.media_type : 1,
        thumbnailUrl,
        takenAt: typeof item.taken_at === 'number' ? item.taken_at : 0,
        caption: item.caption?.text || null,
      };
    })
    .filter((i): i is NonNullable<typeof i> => i !== null);

  return {
    items,
    totalCount: items.length,
    hasMore: data.more_available === true,
    maxId: typeof data.max_id === 'string' ? data.max_id : null,
    reelAutoArchive:
      typeof data.reel_auto_archive === 'string'
        ? data.reel_auto_archive
        : 'on',
  };
}
