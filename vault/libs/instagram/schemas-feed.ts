import { z } from 'zod';

import { CsrfParam } from './schemas-common';

// ============================================================================
// Feed (Home Timeline)
// ============================================================================

export const FeedAuthorSchema = z.object({
  userId: z.string().describe('Author numeric user ID'),
  username: z.string().describe('Author username/handle'),
  fullName: z.string().describe('Author display name'),
  profilePicUrl: z.string().describe('Author profile picture URL'),
  isVerified: z.boolean().describe('Whether author is verified'),
  isPrivate: z.boolean().describe('Whether account is private'),
});

export type FeedAuthor = z.infer<typeof FeedAuthorSchema>;

export const FeedPostSchema = z.object({
  postId: z.string().describe('Post numeric ID (pk)'),
  shortcode: z
    .string()
    .describe('Post shortcode used in URL: instagram.com/p/{shortcode}/'),
  author: FeedAuthorSchema.describe('Post author information'),
  captionText: z
    .string()
    .nullable()
    .describe('Post caption text (null if no caption)'),
  likeCount: z.number().describe('Number of likes'),
  commentCount: z.number().describe('Number of comments'),
  timestamp: z
    .number()
    .describe('Post creation timestamp in seconds (Unix epoch)'),
  mediaType: z
    .number()
    .describe('Media type: 1=photo, 2=video, 8=carousel/album'),
  thumbnailUrl: z.string().nullable().describe('Image or video thumbnail URL'),
  isVideo: z.boolean().describe('Whether the post is a video'),
  videoDuration: z
    .number()
    .nullable()
    .describe(
      'Video duration in seconds, extracted from DASH manifest (null for photos and carousels)',
    ),
});

export type FeedPost = z.infer<typeof FeedPostSchema>;

export const getFeedSchema = {
  name: 'getFeed',
  description:
    'Get the home feed timeline with posts from accounts the authenticated user follows. Returns recent posts with author info, captions, and engagement counts.',
  notes:
    'Returns posts sorted by recency. Use cursor from response for pagination.',
  input: z.object({
    csrf: CsrfParam,
    first: z
      .number()
      .optional()
      .describe('Number of posts to fetch (default: 12)'),
    after: z
      .string()
      .nullable()
      .optional()
      .describe('Cursor for pagination from previous response'),
    variant: z
      .enum(['home', 'following'])
      .optional()
      .describe(
        'Feed variant: "home" for algorithmic feed (default), "following" for chronological following-only feed',
      ),
    feedViewInfo: z
      .string()
      .optional()
      .describe(
        'JSON string of viewed media for seen-post deduplication. Format: [{"media_id":"<id>_<userId>","media_pct":1,"time_info":{"10":ms,"25":ms,"50":ms,"75":ms},"version":24}]. Sent on pagination to avoid repeating already-seen posts.',
      ),
    paginationSource: z
      .enum(['following'])
      .optional()
      .describe(
        'Pagination source context. Set to "following" when variant is "following" to signal the server that pagination is from the following feed. Omitted for the default "home" feed. Affects server-side ranking and deduplication.',
      ),
  }),
  output: z.object({
    posts: z
      .array(FeedPostSchema)
      .describe('Feed posts sorted by most recent first'),
    totalCount: z.number().describe('Number of posts returned'),
    hasMore: z.boolean().describe('Whether more posts exist'),
    cursor: z
      .string()
      .nullable()
      .describe('Cursor for next page, null if no more pages'),
  }),
};

export type GetFeedInput = z.infer<typeof getFeedSchema.input>;
export type GetFeedOutput = z.infer<typeof getFeedSchema.output>;

// ============================================================================
// Explore / Discover
// ============================================================================

export const ExplorePostSchema = z.object({
  postId: z.string().describe('Post numeric ID (pk)'),
  shortcode: z
    .string()
    .describe('Post shortcode used in URL: instagram.com/p/{shortcode}/'),
  author: FeedAuthorSchema.describe('Post author information'),
  captionText: z
    .string()
    .nullable()
    .describe('Post caption text (null if no caption)'),
  likeCount: z.number().describe('Number of likes'),
  commentCount: z.number().describe('Number of comments'),
  timestamp: z
    .number()
    .describe('Post creation timestamp in seconds (Unix epoch)'),
  mediaType: z
    .number()
    .describe('Media type: 1=photo, 2=video, 8=carousel/album'),
  thumbnailUrl: z.string().nullable().describe('Image or video thumbnail URL'),
  isVideo: z.boolean().describe('Whether the post is a video or Reel'),
  videoDuration: z
    .number()
    .nullable()
    .describe('Video duration in seconds (null for photos)'),
});

export type ExplorePost = z.infer<typeof ExplorePostSchema>;

export const ExploreClusterSchema = z.object({
  id: z
    .string()
    .describe(
      'Cluster ID in format "{type}:{index}" e.g. "explore_all:0". Pass as topicClusterId input to filter by this topic.',
    ),
  title: z.string().describe('Display title for the cluster (e.g. "For you")'),
  type: z.string().describe('Cluster type identifier (e.g. "explore_all")'),
  name: z.string().describe('Cluster name (usually same as title)'),
  canMute: z.boolean().describe('Whether the user can mute this topic cluster'),
  isMuted: z
    .boolean()
    .describe('Whether the user has muted this topic cluster'),
});

export type ExploreCluster = z.infer<typeof ExploreClusterSchema>;

export const getExploreSchema = {
  name: 'getExplore',
  description:
    'Get the explore/discover grid of recommended content. Returns trending and personalized posts from across Instagram.',
  notes:
    'Returns recommended posts not necessarily from followed accounts. Use nextMaxId from response for pagination. Pass rankToken back as sessionId on subsequent pages to maintain ranking consistency.',
  input: z.object({
    csrf: CsrfParam,
    maxId: z
      .string()
      .nullable()
      .optional()
      .describe('Pagination cursor from previous response (nextMaxId field)'),
    isNonPersonalizedExplore: z
      .boolean()
      .optional()
      .describe(
        'When true, returns non-personalized content with media_grid layout (photos, videos, carousels). When false (default), returns personalized clips/reels-heavy content.',
      ),
    isPrefetch: z
      .boolean()
      .optional()
      .describe(
        'When true, prefetches explore content for faster rendering. Defaults to false.',
      ),
    module: z
      .enum([
        'explore_popular',
        'explore_type_ahead',
        'igtv_explore',
        'feed_timeline',
      ])
      .optional()
      .describe(
        'Explore module context. "explore_popular" (default) for main explore grid, "explore_type_ahead" for search-triggered explore, "igtv_explore" for IGTV/video content, "feed_timeline" for timeline-style explore.',
      ),
    includeFixedDestinations: z
      .boolean()
      .optional()
      .describe(
        'Include fixed destination links in response. Defaults to true.',
      ),
    omitCoverMedia: z
      .boolean()
      .optional()
      .describe(
        'When true, omits large cover media items from sections. Defaults to false.',
      ),
    sessionId: z
      .string()
      .optional()
      .describe(
        'Session ID for consistent ranking across paginated requests. Returned as rank_token in responses. Use the same value across pages to maintain ranking consistency.',
      ),
    surfaceParam: z
      .enum([
        'explore_topic_all',
        'explore_clips_topic_all',
        'explore_search',
        'explore_ig_media',
      ])
      .optional()
      .describe(
        'Surface context for content selection. "explore_topic_all" for all topics, "explore_clips_topic_all" for clips/reels topics, "explore_search" for search-driven explore, "explore_ig_media" for media-focused explore.',
      ),
    topicClusterId: z
      .string()
      .optional()
      .describe(
        'Topic cluster ID to filter content by topic. Format: "{type}:{index}" e.g. "explore_all:0". Available clusters are returned in the response clusters field.',
      ),
    sessionPagingToken: z
      .string()
      .optional()
      .describe(
        'Session paging token from previous response. Pass on subsequent pages to maintain pagination session consistency and improve post deduplication across pages. Value is returned in the response sessionPagingToken field.',
      ),
  }),
  output: z.object({
    posts: z.array(ExplorePostSchema).describe('Explore grid posts'),
    totalCount: z.number().describe('Number of posts returned'),
    hasMore: z.boolean().describe('Whether more posts exist'),
    nextMaxId: z
      .string()
      .nullable()
      .describe('Cursor for next page, pass as maxId in next call'),
    sessionPagingToken: z
      .string()
      .nullable()
      .describe(
        'Session paging token for maintaining pagination consistency. Pass back as sessionPagingToken on next request along with maxId to improve post deduplication.',
      ),
    rankToken: z
      .string()
      .nullable()
      .describe(
        'Ranking session token (UUID). Pass back as sessionId on subsequent pages to maintain consistent ranking across paginated requests.',
      ),
    clusters: z
      .array(ExploreClusterSchema)
      .describe(
        'Available topic clusters for filtering. Pass a cluster id as topicClusterId to filter content by topic.',
      ),
  }),
};

export type GetExploreInput = z.infer<typeof getExploreSchema.input>;
export type GetExploreOutput = z.infer<typeof getExploreSchema.output>;

// ============================================================================
// All Schemas (for merge)
// ============================================================================

export const feedSchemas = [getFeedSchema, getExploreSchema];
