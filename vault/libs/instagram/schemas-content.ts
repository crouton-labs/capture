import { z } from 'zod';

import { CsrfParam } from './schemas-common';

// ============================================================================
// searchUsers
// ============================================================================

export const SearchUserSchema = z.object({
  userId: z.string().describe('User numeric ID (pk)'),
  username: z.string().describe('Username/handle'),
  fullName: z.string().describe('Display name'),
  profilePicUrl: z.string().describe('Profile picture URL'),
  isVerified: z.boolean().describe('Whether the user is verified'),
  isPrivate: z.boolean().describe('Whether the account is private'),
  followerCount: z.number().describe('Number of followers'),
});

export type SearchUser = z.infer<typeof SearchUserSchema>;

export const SearchHashtagSchema = z.object({
  id: z.number().describe('Hashtag numeric ID'),
  name: z.string().describe('Hashtag name without #'),
  mediaCount: z.number().describe('Number of posts using this hashtag'),
});

export type SearchHashtag = z.infer<typeof SearchHashtagSchema>;

export const SearchPlaceSchema = z.object({
  id: z.string().describe('Place/location numeric ID'),
  name: z.string().describe('Place name'),
  address: z.string().describe('Place address'),
  lat: z.number().nullable().describe('Latitude'),
  lng: z.number().nullable().describe('Longitude'),
});

export type SearchPlace = z.infer<typeof SearchPlaceSchema>;

export const searchUsersSchema = {
  name: 'searchUsers',
  description:
    'Lightweight blended search (legacy top-search endpoint) returning users, hashtags, and places. Use getSearchSuggestions instead when you need social context ("Followed by X") or to restrict results to a single type.',
  notes:
    'Backed by the /web/search/topsearch/ endpoint. Results are ranked by relevance; user-only queries still return empty hashtags/places arrays. For richer results (social context, type filtering) prefer getSearchSuggestions.',
  input: z.object({
    csrf: CsrfParam,
    query: z.string().describe('Search query text'),
  }),
  output: z.object({
    users: z.array(SearchUserSchema).describe('Matching user accounts'),
    hashtags: z.array(SearchHashtagSchema).describe('Matching hashtags'),
    places: z.array(SearchPlaceSchema).describe('Matching places/locations'),
  }),
};

export type SearchUsersInput = z.infer<typeof searchUsersSchema.input>;
export type SearchUsersOutput = z.infer<typeof searchUsersSchema.output>;

// ============================================================================
// getPostDetail
// ============================================================================

export const PostOwnerSchema = z.object({
  userId: z.string().describe('Owner numeric user ID'),
  username: z.string().describe('Owner username'),
  fullName: z.string().describe('Owner display name'),
  profilePicUrl: z.string().describe('Owner profile picture URL'),
  isVerified: z.boolean().describe('Whether the owner is verified'),
  isPrivate: z.boolean().describe('Whether the owner account is private'),
});

export type PostOwner = z.infer<typeof PostOwnerSchema>;

export const PostCommentSchema = z.object({
  id: z.string().describe('Comment ID'),
  text: z.string().describe('Comment text'),
  createdAt: z
    .number()
    .describe('Comment creation timestamp in seconds (Unix epoch)'),
  ownerUsername: z.string().describe('Comment author username'),
  likeCount: z.number().describe('Number of likes on this comment'),
});

export type PostComment = z.infer<typeof PostCommentSchema>;

export const PostDetailSchema = z.object({
  postId: z.string().describe('Post numeric ID'),
  shortcode: z
    .string()
    .describe('Post shortcode from URL: instagram.com/p/{shortcode}/'),
  typename: z
    .string()
    .describe('Media type: GraphImage, GraphVideo, or GraphSidecar'),
  owner: PostOwnerSchema.describe('Post author information'),
  captionText: z
    .string()
    .nullable()
    .describe('Post caption text (null if no caption)'),
  displayUrl: z.string().describe('Primary display image URL'),
  isVideo: z.boolean().describe('Whether the post is a video'),
  videoUrl: z.string().nullable().describe('Video URL (null for photos)'),
  likeCount: z.number().describe('Number of likes'),
  commentCount: z.number().describe('Number of comments'),
  timestamp: z
    .number()
    .describe('Post creation timestamp in seconds (Unix epoch)'),
  locationName: z
    .string()
    .nullable()
    .describe('Tagged location name (null if none)'),
  accessibilityCaption: z
    .string()
    .nullable()
    .describe('Alt text / accessibility caption'),
  comments: z.array(PostCommentSchema).describe('Top comments on the post'),
  carouselMediaUrls: z
    .array(z.string())
    .describe('Display URLs for carousel/album items (empty for single media)'),
});

export type PostDetail = z.infer<typeof PostDetailSchema>;

export const getPostDetailSchema = {
  name: 'getPostDetail',
  description:
    'Get full details of a single post by its shortcode (from the post URL). Returns caption, engagement counts, comments, and media URLs.',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    shortcode: z
      .string()
      .describe('Post shortcode from the URL: instagram.com/p/{shortcode}/'),
  }),
  output: PostDetailSchema,
};

export type GetPostDetailInput = z.infer<typeof getPostDetailSchema.input>;
export type GetPostDetailOutput = z.infer<typeof getPostDetailSchema.output>;

// ============================================================================
// getSavedPosts
// ============================================================================

export const SavedPostSchema = z.object({
  postId: z.string().describe('Post numeric ID (pk)'),
  shortcode: z
    .string()
    .describe('Post shortcode used in URL: instagram.com/p/{shortcode}/'),
  author: z
    .object({
      userId: z.string().describe('Author numeric user ID'),
      username: z.string().describe('Author username'),
      fullName: z.string().describe('Author display name'),
      profilePicUrl: z.string().describe('Author profile picture URL'),
      isVerified: z.boolean().describe('Whether the author is verified'),
      isPrivate: z.boolean().describe('Whether the author account is private'),
    })
    .describe('Post author information'),
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
});

export type SavedPost = z.infer<typeof SavedPostSchema>;

export const getSavedPostsSchema = {
  name: 'getSavedPosts',
  description:
    "Get the authenticated user's saved/bookmarked posts. Returns saved posts with author info, captions, and engagement counts.",
  notes:
    "Only accessible for the authenticated user's own saved posts. Use nextMaxId from response for pagination.",
  input: z.object({
    csrf: CsrfParam,
    maxId: z
      .string()
      .nullable()
      .optional()
      .describe('Pagination cursor from previous response (nextMaxId field)'),
  }),
  output: z.object({
    posts: z.array(SavedPostSchema).describe('Saved posts'),
    totalCount: z.number().describe('Number of posts returned in this page'),
    hasMore: z.boolean().describe('Whether more saved posts exist'),
    nextMaxId: z
      .string()
      .nullable()
      .describe('Cursor for next page, pass as maxId in next call'),
  }),
};

export type GetSavedPostsInput = z.infer<typeof getSavedPostsSchema.input>;
export type GetSavedPostsOutput = z.infer<typeof getSavedPostsSchema.output>;

// ============================================================================
// getSuggestedUsers
// ============================================================================

export const SuggestedUserSchema = z.object({
  userId: z.string().describe('User numeric ID (pk)'),
  username: z.string().describe('Username/handle'),
  fullName: z.string().describe('Display name'),
  profilePicUrl: z.string().describe('Profile picture URL'),
  isVerified: z.boolean().describe('Whether the user is verified'),
  isPrivate: z.boolean().describe('Whether the account is private'),
});

export type SuggestedUser = z.infer<typeof SuggestedUserSchema>;

export const getSuggestedUsersSchema = {
  name: 'getSuggestedUsers',
  description:
    'Get "accounts you might like" suggestions for the authenticated viewer. Returns accounts Instagram recommends via the Discover People feed.',
  notes:
    'Returns general suggestions for the authenticated viewer — there is no target user. Only the first page (~30 suggestions) is returned.',
  input: z.object({
    csrf: CsrfParam,
    userId: z
      .string()
      .optional()
      .describe('Unused — suggestions are for the authenticated viewer, not a target user'),
  }),
  output: z.object({
    users: z
      .array(SuggestedUserSchema)
      .describe('Suggested similar user accounts'),
    totalCount: z.number().describe('Number of suggested users returned'),
  }),
};

export type GetSuggestedUsersInput = z.infer<
  typeof getSuggestedUsersSchema.input
>;
export type GetSuggestedUsersOutput = z.infer<
  typeof getSuggestedUsersSchema.output
>;

// ============================================================================
// Discovery feeds (hashtag / location) — shared media shape
// ============================================================================

export const DiscoveryMediaSchema = z.object({
  postId: z.string().describe('Post numeric ID (pk)'),
  shortcode: z
    .string()
    .describe('Post shortcode used in URL: instagram.com/p/{shortcode}/'),
  author: z
    .object({
      userId: z.string().describe('Author numeric user ID'),
      username: z.string().describe('Author username/handle'),
      fullName: z.string().describe('Author display name'),
      isVerified: z.boolean().describe('Whether the author is verified'),
      isPrivate: z.boolean().describe('Whether the author account is private'),
    })
    .describe(
      'Who posted this — discovery feeds span many accounts, so each item carries its author (key for prospecting).',
    ),
  captionText: z
    .string()
    .nullable()
    .describe('Post caption text (null if no caption)'),
  thumbnailUrl: z.string().describe('Image or video thumbnail URL'),
  mediaType: z
    .number()
    .describe('Media type: 1=photo, 2=video/reel, 8=carousel/album'),
  isVideo: z.boolean().describe('Whether the post is a video/reel'),
  likeCount: z.number().describe('Number of likes'),
  commentCount: z.number().describe('Number of comments'),
  viewCount: z
    .number()
    .nullable()
    .describe('Play/view count for videos (null for images)'),
  takenAt: z.number().describe('Post creation timestamp (Unix seconds)'),
});

export type DiscoveryMedia = z.infer<typeof DiscoveryMediaSchema>;

const DiscoveryFeedOutput = z.object({
  posts: z.array(DiscoveryMediaSchema).describe('Posts in this page of the feed'),
  totalCount: z.number().describe('Number of posts returned in this page'),
  hasMore: z.boolean().describe('Whether more posts exist'),
  nextMaxId: z
    .string()
    .nullable()
    .describe('Pagination cursor for the next page (pass as maxId). Null when no more pages.'),
});

export const getHashtagFeedSchema = {
  name: 'getHashtagFeed',
  description:
    'Get posts for a hashtag — the top or most-recent media tagged with #{hashtag}. Each post carries its author, so this is the primary way to discover and prospect accounts posting about a topic.',
  notes:
    "Pass the hashtag WITHOUT the leading '#'. tab='top' (default) returns the ranked top posts; tab='recent' returns the latest posts chronologically; tab='clips' returns reels. Paginate by passing the returned nextMaxId as maxId.",
  input: z.object({
    csrf: CsrfParam,
    hashtag: z.string().describe("Hashtag name without the leading '#'"),
    tab: z
      .enum(['top', 'recent', 'clips'])
      .default('top')
      .describe('Which tab to fetch: top (ranked), recent (chronological), or clips (reels)'),
    maxId: z
      .string()
      .optional()
      .describe('Pagination cursor from a previous response (nextMaxId). Omit for the first page.'),
  }),
  output: DiscoveryFeedOutput,
};

export type GetHashtagFeedInput = z.infer<typeof getHashtagFeedSchema.input>;
export type GetHashtagFeedOutput = z.infer<typeof getHashtagFeedSchema.output>;

export const getLocationFeedSchema = {
  name: 'getLocationFeed',
  description:
    'Get posts tagged at a location (place) by its numeric location ID. Each post carries its author — useful for geo-targeted discovery and prospecting.',
  notes:
    "Takes a numeric locationId, not a place name. Get a locationId from searchUsers/getSearchSuggestions (the `places` array `id`). tab='ranked' (default) returns top posts; tab='recent' returns the latest. Paginate via nextMaxId.",
  input: z.object({
    csrf: CsrfParam,
    locationId: z.string().describe('Numeric location/place ID (from search results)'),
    tab: z
      .enum(['ranked', 'recent'])
      .default('ranked')
      .describe('Which tab to fetch: ranked (top) or recent (chronological)'),
    maxId: z
      .string()
      .optional()
      .describe('Pagination cursor from a previous response (nextMaxId). Omit for the first page.'),
  }),
  output: DiscoveryFeedOutput,
};

export type GetLocationFeedInput = z.infer<typeof getLocationFeedSchema.input>;
export type GetLocationFeedOutput = z.infer<typeof getLocationFeedSchema.output>;

// ============================================================================
// All Schemas (for merge)
// ============================================================================

export const contentSchemas = [
  searchUsersSchema,
  getPostDetailSchema,
  getSavedPostsSchema,
  getSuggestedUsersSchema,
  getHashtagFeedSchema,
  getLocationFeedSchema,
];
