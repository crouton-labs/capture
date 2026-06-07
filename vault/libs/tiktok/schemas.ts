import { z } from 'zod';

export const libraryDescription =
  'TikTok Studio operations: content management, analytics, comments, and monetization for TikTok creators';

export const libraryIcon = '/icons/libs/tiktok.svg';
export const loginUrl = 'https://www.tiktok.com/tiktokstudio';

export const libraryNotes = `
## Workflow

1. Navigate to \`https://www.tiktok.com/tiktokstudio\`
2. Call \`getContext()\` to get \`{ csrfToken, uid, secUid, uniqueId, deviceId, region }\`
3. Pass the full context object to subsequent functions

## Key Concepts

- **Posts (Items)**: Published or scheduled TikTok videos. Identified by numeric \`itemId\`.
- **Insight Types**: Analytics data comes from the insight API with specific type codes (vv_history, pv_history, etc.)
- **Date Ranges**: Analytics use \`days\` (number of days of history) and \`endDays\` (offset from today, typically 2 = yesterday).
- **Status Codes**: API \`status_code: 0\` = success. Non-zero means error; check \`status_msg\`.

## Pagination

Cursor-based for content: pass \`cursor\` from previous response to get next page. \`has_more: false\` means no more data.

## Account Limitations

Some features require minimum followers or specific account types:
- Monetization: 10K+ followers for Creator Rewards
- Scheduling: Available for most accounts
- Analytics: Available for all accounts but data appears after posting content
`;

// ============================================================================
// Rate Limits
// ============================================================================

export const rateLimits: Record<
  string,
  Array<{
    window: 'SECOND' | 'MINUTE' | 'HOUR' | 'DAY';
    maxCalls: number;
    message: string;
  }>
> = {
  replyToComment: [
    {
      window: 'MINUTE',
      maxCalls: 10,
      message: 'Comment-reply bursts trigger TikTok anti-spam',
    },
    { window: 'DAY', maxCalls: 100, message: 'Daily reply ceiling' },
  ],
  updateProfile: [
    {
      window: 'HOUR',
      maxCalls: 5,
      message: 'Profile-edit churn looks bot-like',
    },
  ],
};

// ============================================================================
// Context
// ============================================================================

export const getContextSchema = {
  name: 'getContext',
  description:
    'Get authentication context for TikTok Studio API calls. Returns CSRF token, user identity, and device info needed by all other functions.',
  notes:
    'Call FIRST before any other TikTok operations. Must be on a tiktokstudio page (not a full-page reload; the SPA must be loaded).',
  input: z.object({}),
  output: z.object({
    csrfToken: z.string().describe('CSRF token for API requests'),
    uid: z.string().describe('Numeric user ID'),
    secUid: z.string().describe('Secure user ID (base64-encoded)'),
    uniqueId: z.string().describe('Username/handle'),
    nickName: z.string().describe('Display name'),
    deviceId: z.string().describe('Device/web ID for API calls'),
    region: z.string().describe('User region code (e.g., "US")'),
    language: z.string().describe('App language (e.g., "en")'),
    avatarUrl: z.string().describe('Profile avatar URL'),
    isPrivateAccount: z.boolean().describe('Whether account is private'),
    analyticsOn: z.boolean().describe('Whether analytics are enabled'),
  }),
};

export type GetContextOutput = z.infer<typeof getContextSchema.output>;

// ============================================================================
// Content / Posts
// ============================================================================

export const PostSchema = z.object({
  itemId: z.string().describe('Unique post/item ID'),
  desc: z.string().describe('Post description/caption'),
  createTime: z.number().describe('Post creation timestamp (Unix seconds)'),
  postTime: z.number().describe('Post publish timestamp (Unix seconds)'),
  duration: z.number().describe('Video duration in seconds'),
  stats: z
    .object({
      playCount: z.number().describe('Total view count'),
      diggCount: z.number().describe('Total like count'),
      commentCount: z.number().describe('Total comment count'),
      shareCount: z.number().describe('Total share count'),
      collectCount: z.number().describe('Total save/favorite count'),
    })
    .describe('Post engagement statistics'),
  coverUrl: z.string().describe('Cover image URL'),
  videoUrl: z.string().describe('Video URL'),
  status: z
    .number()
    .describe('Post status code: 0=public, 1=private, 2=friends only'),
  isScheduled: z.boolean().describe('Whether post is scheduled for future'),
  scheduledPublishTime: z
    .number()
    .optional()
    .describe('Scheduled publish time (Unix seconds), if scheduled'),
});

export type Post = z.infer<typeof PostSchema>;

export const listPostsSchema = {
  name: 'listPosts',
  description:
    'List all published and scheduled TikTok posts with engagement stats (views, likes, comments, shares). Returns posts sorted by publish date (newest first).',
  notes:
    'Returns empty array if account has no posts. Auto-paginates up to maxPages.',
  input: z.object({
    csrfToken: z.string().describe('CSRF token from getContext()'),
    deviceId: z.string().describe('Device ID from getContext()'),
    region: z.string().describe('Region from getContext()'),
    language: z.string().describe('Language from getContext()'),
    recentOnly: z
      .boolean()
      .optional()
      .default(false)
      .describe('If true, only return recent posts (last 7 days)'),
    maxPages: z
      .number()
      .optional()
      .default(5)
      .describe(
        'Maximum pages to fetch (50 posts per page). Default 5 = up to 250 posts.',
      ),
  }),
  output: z.object({
    posts: z.array(PostSchema).describe('List of posts'),
    totalFetched: z.number().describe('Total number of posts fetched'),
    hasMore: z.boolean().describe('Whether more posts exist beyond maxPages'),
  }),
};

export type ListPostsInput = z.infer<typeof listPostsSchema.input>;
export type ListPostsOutput = z.infer<typeof listPostsSchema.output>;

// ============================================================================
// Analytics
// ============================================================================

export const InsightDataPointSchema = z.object({
  value: z.number().describe('Metric value for this data point'),
  date: z
    .string()
    .optional()
    .describe('Date string for this data point (YYYYMMDD format)'),
});

export type InsightDataPoint = z.infer<typeof InsightDataPointSchema>;

export const getAccountAnalyticsSchema = {
  name: 'getAccountAnalytics',
  description:
    'Get account-level analytics for a date range. Returns daily time series for views, profile views, likes, comments, shares, and follower history. Also returns current follower count.',
  notes:
    'Data uses `days` parameter for range. Common values: 7 (last week), 28 (last month), 60 (last 2 months). endDays=2 means data ends yesterday. Data points with no activity may have status=2 (no data) instead of value.',
  input: z.object({
    csrfToken: z.string().describe('CSRF token from getContext()'),
    deviceId: z.string().describe('Device ID from getContext()'),
    region: z.string().describe('Region from getContext()'),
    language: z.string().describe('Language from getContext()'),
    days: z
      .number()
      .optional()
      .default(28)
      .describe(
        'Number of days of history to fetch. Default 28. Common values: 7, 28, 60.',
      ),
  }),
  output: z.object({
    followerCount: z.number().describe('Current total follower count'),
    videoViews: z
      .array(InsightDataPointSchema)
      .describe('Daily video view counts'),
    profileViews: z
      .array(InsightDataPointSchema)
      .describe('Daily profile view counts'),
    likes: z.array(InsightDataPointSchema).describe('Daily like counts'),
    comments: z.array(InsightDataPointSchema).describe('Daily comment counts'),
    shares: z.array(InsightDataPointSchema).describe('Daily share counts'),
    followers: z
      .array(InsightDataPointSchema)
      .describe('Daily follower count history'),
    reachedAudience: z
      .array(InsightDataPointSchema)
      .describe('Daily reached audience counts'),
    period: z.object({
      days: z.number().describe('Number of days in the period'),
      endDays: z.number().describe('End day offset (2 = yesterday)'),
    }),
  }),
};

export type GetAccountAnalyticsInput = z.infer<
  typeof getAccountAnalyticsSchema.input
>;
export type GetAccountAnalyticsOutput = z.infer<
  typeof getAccountAnalyticsSchema.output
>;

// ============================================================================
// Per-Video Analytics
// ============================================================================

export const getPostAnalyticsSchema = {
  name: 'getPostAnalytics',
  description:
    'Get detailed per-video analytics for a specific TikTok post. Returns 7-day daily breakdown for views, likes, comments, shares, favorites, video completion rate, and new followers gained. Also returns first-48-hour view spike data.',
  notes:
    'Only works for posts that exist on the account. Use listPosts() to get valid itemId values. Data may be sparse for posts less than 7 days old.',
  input: z.object({
    csrfToken: z.string().describe('CSRF token from getContext()'),
    deviceId: z.string().describe('Device ID from getContext()'),
    region: z.string().describe('Region from getContext()'),
    language: z.string().describe('Language from getContext()'),
    itemId: z.string().describe('Post/item ID to fetch analytics for'),
  }),
  output: z.object({
    itemId: z.string().describe('The post item ID'),
    videoViews: z
      .array(InsightDataPointSchema)
      .describe('Daily video view counts over the last 7 days'),
    likes: z
      .array(InsightDataPointSchema)
      .describe('Daily like counts over the last 7 days'),
    comments: z
      .array(InsightDataPointSchema)
      .describe('Daily comment counts over the last 7 days'),
    shares: z
      .array(InsightDataPointSchema)
      .describe('Daily share counts over the last 7 days'),
    favorites: z
      .array(InsightDataPointSchema)
      .describe('Daily save/favorite counts over the last 7 days'),
    completionRate: z
      .array(InsightDataPointSchema)
      .describe(
        'Daily average video completion rate (0-1, e.g. 0.72 = 72% watched) over 7 days',
      ),
    newFollowers: z
      .array(InsightDataPointSchema)
      .describe(
        'Daily new followers gained from this post over the last 7 days',
      ),
    views48h: z
      .array(InsightDataPointSchema)
      .describe('Hourly/daily view counts in the first 48 hours after posting'),
    previousVideoViews7d: z
      .array(InsightDataPointSchema)
      .describe(
        'Previous 7-day comparison window for video views (for trend comparison)',
      ),
  }),
};

export type GetPostAnalyticsInput = z.infer<
  typeof getPostAnalyticsSchema.input
>;
export type GetPostAnalyticsOutput = z.infer<
  typeof getPostAnalyticsSchema.output
>;

// ============================================================================
// Audience Insights
// ============================================================================

export const getAudienceInsightsSchema = {
  name: 'getAudienceInsights',
  description:
    'Get audience insights for the TikTok account. Returns follower activity patterns by day and hour (shows when followers are most active), daily reached audience history, and unique viewer counts. Note: demographic breakdowns (gender/age/territory) require an established account with significant followers and are not available for new accounts.',
  notes:
    'followerActivityDays and followerActivityHours show relative activity; data points with status=2 mean no data for that period (typically new accounts). Returns empty arrays if account has no follower activity.',
  input: z.object({
    csrfToken: z.string().describe('CSRF token from getContext()'),
    deviceId: z.string().describe('Device ID from getContext()'),
    region: z.string().describe('Region from getContext()'),
    language: z.string().describe('Language from getContext()'),
    days: z
      .number()
      .optional()
      .default(28)
      .describe('Number of days of history to fetch. Default 28.'),
  }),
  output: z.object({
    followerActivityDays: z
      .array(InsightDataPointSchema)
      .describe(
        'Daily follower activity trend for the requested period. Index corresponds to each calendar day.',
      ),
    followerActivityHours: z
      .array(InsightDataPointSchema)
      .describe(
        'Follower activity time-series at hourly granularity for the recent period.',
      ),
    reachedAudience: z
      .array(InsightDataPointSchema)
      .describe('Daily count of unique accounts that saw your content'),
    uniqueViewerCount: z
      .number()
      .describe('Total unique viewers in the last 28 days (0 if no data)'),
    followerCount: z.number().describe('Current total follower count'),
    period: z.object({
      days: z.number().describe('Number of days in the period'),
      endDays: z.number().describe('End day offset (2 = yesterday)'),
    }),
  }),
};

export type GetAudienceInsightsInput = z.infer<
  typeof getAudienceInsightsSchema.input
>;
export type GetAudienceInsightsOutput = z.infer<
  typeof getAudienceInsightsSchema.output
>;

// ============================================================================
// Follower Growth
// ============================================================================

export const getFollowerGrowthSchema = {
  name: 'getFollowerGrowth',
  description:
    'Get follower growth over time with daily granularity. Returns net new followers per day, daily follower count history, and current total follower count. Shows growth trends and unfollows.',
  notes:
    'followerHistory may have gaps (status=2) on days with no follower change; net change is always computable but snapshots are sparse.',
  input: z.object({
    csrfToken: z.string().describe('CSRF token from getContext()'),
    deviceId: z.string().describe('Device ID from getContext()'),
    region: z.string().describe('Region from getContext()'),
    language: z.string().describe('Language from getContext()'),
    days: z
      .number()
      .optional()
      .default(28)
      .describe('Number of days of history to fetch. Default 28.'),
  }),
  output: z.object({
    currentFollowerCount: z.number().describe('Current total follower count'),
    netFollowers: z
      .array(InsightDataPointSchema)
      .describe(
        'Daily net follower change (positive = gained followers, negative = lost followers). All values present because net change is always computable.',
      ),
    followerHistory: z
      .array(InsightDataPointSchema)
      .describe(
        'Daily total follower count snapshots. May have gaps (status=2) on days with no change.',
      ),
    totalNetGain: z
      .number()
      .describe('Sum of net follower changes over the period'),
    period: z.object({
      days: z.number().describe('Number of days in the period'),
      endDays: z.number().describe('End day offset (2 = yesterday)'),
    }),
  }),
};

export type GetFollowerGrowthInput = z.infer<
  typeof getFollowerGrowthSchema.input
>;
export type GetFollowerGrowthOutput = z.infer<
  typeof getFollowerGrowthSchema.output
>;

// ============================================================================
// Top Posts
// ============================================================================

export const TopPostMetricSchema = z
  .enum(['views', 'likes', 'comments', 'shares', 'saves'])
  .describe(
    'Metric to rank posts by. views=play_count, likes=digg_count, comments=comment_count, shares=share_count, saves=collect_count',
  );

export const getTopPostsSchema = {
  name: 'getTopPosts',
  description:
    'Get top performing posts ranked by a chosen engagement metric (views, likes, comments, shares, or saves). Returns posts sorted by the selected metric in descending order.',
  notes:
    'Fetches up to 5 pages (250 posts) to find top performers. Sorting is done from the fetched pool; accounts with very large post libraries may not include oldest posts.',
  input: z.object({
    csrfToken: z.string().describe('CSRF token from getContext()'),
    deviceId: z.string().describe('Device ID from getContext()'),
    region: z.string().describe('Region from getContext()'),
    language: z.string().describe('Language from getContext()'),
    metric: TopPostMetricSchema.optional()
      .default('views')
      .describe('Metric to rank by. Default: views'),
    limit: z
      .number()
      .optional()
      .default(10)
      .describe('Number of top posts to return. Default 10, max 50.'),
    maxPages: z
      .number()
      .optional()
      .default(5)
      .describe(
        'Maximum pages to fetch before ranking (50 posts/page). Default 5.',
      ),
  }),
  output: z.object({
    posts: z
      .array(
        z.object({
          itemId: z.string().describe('Post/item ID'),
          desc: z.string().describe('Post caption/description'),
          postTime: z
            .number()
            .describe('Post publish timestamp (Unix seconds)'),
          duration: z.number().describe('Video duration in seconds'),
          stats: z.object({
            playCount: z.number().describe('Total view count'),
            diggCount: z.number().describe('Total like count'),
            commentCount: z.number().describe('Total comment count'),
            shareCount: z.number().describe('Total share count'),
            collectCount: z.number().describe('Total save/favorite count'),
          }),
          coverUrl: z.string().describe('Cover image URL'),
          rankValue: z
            .number()
            .describe('Value of the ranking metric for this post'),
        }),
      )
      .describe('Top posts sorted by the selected metric (highest first)'),
    metric: TopPostMetricSchema.describe('The metric used for ranking'),
    totalPostsSearched: z
      .number()
      .describe('Total number of posts searched to find top performers'),
  }),
};

export type GetTopPostsInput = z.infer<typeof getTopPostsSchema.input>;
export type GetTopPostsOutput = z.infer<typeof getTopPostsSchema.output>;

// ============================================================================
// Comments
// ============================================================================

export const CommentAuthorSchema = z.object({
  uid: z.string().describe('Commenter user ID'),
  uniqueId: z.string().describe('Commenter username/handle'),
  nickname: z.string().describe('Commenter display name'),
  avatarUrl: z.string().optional().describe('Commenter avatar URL'),
  followerCount: z.number().optional().describe('Commenter follower count'),
  isFollower: z
    .boolean()
    .optional()
    .describe('Whether commenter follows the creator'),
});

export type CommentAuthor = z.infer<typeof CommentAuthorSchema>;

export const CommentSchema = z.object({
  commentId: z.string().describe('Unique comment ID'),
  itemId: z.string().describe('Post/video ID this comment belongs to'),
  text: z.string().describe('Comment text content'),
  createTime: z.number().describe('Comment creation timestamp (Unix seconds)'),
  diggCount: z.number().describe('Number of likes on this comment'),
  replyCount: z.number().describe('Number of replies to this comment'),
  creatorReplied: z
    .boolean()
    .describe('Whether the creator (you) has replied to this comment'),
  author: CommentAuthorSchema.describe('The user who posted this comment'),
});

export type Comment = z.infer<typeof CommentSchema>;

export const listCommentsSchema = {
  name: 'listComments',
  description:
    'List comments on your TikTok posts. Supports filtering by reply status (replied/unreplied by creator), follower status, keyword search, and specific post. Auto-paginates.',
  notes:
    'Returns empty array if account has no posts or no comments in the date range. Use replyStatus=1 (unreplied) to find comments that need responses.',
  input: z.object({
    csrfToken: z.string().describe('CSRF token from getContext()'),
    deviceId: z.string().describe('Device ID from getContext()'),
    region: z.string().describe('Region from getContext()'),
    language: z.string().describe('Language from getContext()'),
    itemId: z
      .string()
      .optional()
      .describe(
        'Filter by specific post/video ID. Omit to get comments across all posts.',
      ),
    replyStatus: z
      .union([z.literal(0), z.literal(1), z.literal(2)])
      .optional()
      .default(0)
      .describe(
        'Filter by creator reply status: 0=all (default), 1=not replied by creator, 2=replied by creator',
      ),
    followerStatus: z
      .union([z.literal(0), z.literal(1), z.literal(2)])
      .optional()
      .default(0)
      .describe(
        'Filter by whether commenter follows you: 0=all (default), 1=followers only, 2=non-followers only',
      ),
    keyword: z
      .string()
      .optional()
      .describe('Filter by keyword in comment text'),
    startDate: z
      .number()
      .optional()
      .describe(
        'Start of date range as Unix timestamp seconds. Defaults to 30 days ago.',
      ),
    endDate: z
      .number()
      .optional()
      .describe(
        'End of date range as Unix timestamp seconds. Defaults to now.',
      ),
    maxPages: z
      .number()
      .optional()
      .default(5)
      .describe(
        'Maximum pages to fetch (20 comments per page). Default 5 = up to 100 comments.',
      ),
  }),
  output: z.object({
    comments: z.array(CommentSchema).describe('List of comments'),
    totalFetched: z.number().describe('Total number of comments fetched'),
    hasMore: z
      .boolean()
      .describe('Whether more comments exist beyond maxPages'),
  }),
};

export type ListCommentsInput = z.infer<typeof listCommentsSchema.input>;
export type ListCommentsOutput = z.infer<typeof listCommentsSchema.output>;

export const getCommentCountSchema = {
  name: 'getCommentCount',
  description:
    'Get total comment counts across your posts, including unreplied count. Efficiently reads from post statistics without paginating all comments.',
  notes: 'Returns 0 for all counts if account has no posts.',
  input: z.object({
    csrfToken: z.string().describe('CSRF token from getContext()'),
    deviceId: z.string().describe('Device ID from getContext()'),
    region: z.string().describe('Region from getContext()'),
    language: z.string().describe('Language from getContext()'),
  }),
  output: z.object({
    totalComments: z
      .number()
      .describe('Total comment count across all posts (from post statistics)'),
    postsWithComments: z
      .number()
      .describe('Number of posts that have at least one comment'),
    perPost: z
      .array(
        z.object({
          itemId: z.string().describe('Post ID'),
          desc: z.string().describe('Post description/caption'),
          commentCount: z.number().describe('Comment count for this post'),
        }),
      )
      .describe('Comment counts per post, sorted by comment count descending'),
  }),
};

export type GetCommentCountInput = z.infer<typeof getCommentCountSchema.input>;
export type GetCommentCountOutput = z.infer<
  typeof getCommentCountSchema.output
>;

export const replyToCommentSchema = {
  name: 'replyToComment',
  description: 'Reply to a specific comment on one of your TikTok posts.',
  notes:
    'Requires itemId (the post the comment is on) and commentId (the specific comment to reply to). Both are available from listComments().',
  input: z.object({
    csrfToken: z.string().describe('CSRF token from getContext()'),
    deviceId: z.string().describe('Device ID from getContext()'),
    region: z.string().describe('Region from getContext()'),
    language: z.string().describe('Language from getContext()'),
    itemId: z
      .string()
      .describe(
        'Post/video ID that the comment belongs to (from listComments)',
      ),
    commentId: z
      .string()
      .describe('Comment ID to reply to (from listComments)'),
    text: z.string().describe('Reply text content'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the reply was posted successfully'),
    replyCommentId: z
      .string()
      .optional()
      .describe('Comment ID of the newly created reply'),
  }),
};

export type ReplyToCommentInput = z.infer<typeof replyToCommentSchema.input>;
export type ReplyToCommentOutput = z.infer<typeof replyToCommentSchema.output>;

export const deleteCommentSchema = {
  name: 'deleteComment',
  description: 'Delete a single comment from one of your TikTok posts.',
  notes:
    'Can only delete comments on your own posts. The commentId is available from listComments().',
  input: z.object({
    csrfToken: z.string().describe('CSRF token from getContext()'),
    deviceId: z.string().describe('Device ID from getContext()'),
    region: z.string().describe('Region from getContext()'),
    language: z.string().describe('Language from getContext()'),
    commentId: z.string().describe('Comment ID to delete (from listComments)'),
  }),
  output: z.object({
    success: z
      .boolean()
      .describe('Whether the comment was deleted successfully'),
  }),
};

export type DeleteCommentInput = z.infer<typeof deleteCommentSchema.input>;
export type DeleteCommentOutput = z.infer<typeof deleteCommentSchema.output>;

export const deleteCommentsSchema = {
  name: 'deleteComments',
  description: 'Bulk delete multiple comments from your TikTok posts.',
  notes:
    'Deletes each comment sequentially. All commentIds must belong to posts you own. Get commentIds from listComments().',
  input: z.object({
    csrfToken: z.string().describe('CSRF token from getContext()'),
    deviceId: z.string().describe('Device ID from getContext()'),
    region: z.string().describe('Region from getContext()'),
    language: z.string().describe('Language from getContext()'),
    commentIds: z
      .array(z.string())
      .describe('List of comment IDs to delete (from listComments)'),
  }),
  output: z.object({
    success: z
      .boolean()
      .describe('Whether all comments were deleted successfully'),
    deletedCount: z.number().describe('Number of comments deleted'),
  }),
};

export const pinCommentSchema = {
  name: 'pinComment',
  description:
    'Pin a comment to the top of a TikTok post. Only one comment can be pinned at a time.',
  notes:
    'Pinning a new comment automatically unpins the previously pinned comment. Use listComments() to get commentId and itemId.',
  input: z.object({
    csrfToken: z.string().describe('CSRF token from getContext()'),
    deviceId: z.string().describe('Device ID from getContext()'),
    region: z.string().describe('Region from getContext()'),
    language: z.string().describe('Language from getContext()'),
    commentId: z.string().describe('Comment ID to pin (from listComments)'),
    itemId: z
      .string()
      .describe('Post/video ID the comment belongs to (from listComments)'),
  }),
  output: z.object({
    success: z
      .boolean()
      .describe('Whether the comment was pinned successfully'),
  }),
};

export const unpinCommentSchema = {
  name: 'unpinComment',
  description: 'Unpin the currently pinned comment from a TikTok post.',
  notes:
    'Use listComments() to find the currently pinned comment (it will be at the top). Use itemId from listComments or listPosts.',
  input: z.object({
    csrfToken: z.string().describe('CSRF token from getContext()'),
    deviceId: z.string().describe('Device ID from getContext()'),
    region: z.string().describe('Region from getContext()'),
    language: z.string().describe('Language from getContext()'),
    commentId: z.string().describe('Comment ID to unpin (from listComments)'),
    itemId: z.string().describe('Post/video ID the comment belongs to'),
  }),
  output: z.object({
    success: z
      .boolean()
      .describe('Whether the comment was unpinned successfully'),
  }),
};

// ============================================================================
// Discovery / Trends
// ============================================================================

export const TrendingRegionSchema = z
  .enum([
    'All',
    'US',
    'JP',
    'GB',
    'DE',
    'MX',
    'CA',
    'FR',
    'KR',
    'ID',
    'BR',
    'PH',
    'AU',
    'IT',
    'ES',
  ])
  .describe(
    'Region filter. All = global trending, or a specific country code.',
  );

export const TrendingCategorySchema = z
  .enum([
    'All',
    'Entertainment',
    'Beauty_Style',
    'Performance',
    'Sport & Outdoor',
    'Society',
    'Lifestyle',
    'Auto_Vehicle',
    'Talents',
    'Nature',
    'Culture_Education_Technology',
    'Supernatural_Horror',
  ])
  .describe('Content category/vertical filter.');

export const getTrendingPostsSchema = {
  name: 'getTrendingPosts',
  description:
    'Get trending TikTok videos from the Inspiration page. Returns videos currently trending on TikTok globally or in a specific region, filterable by content category. Includes view counts, like counts, and video cover/play URLs.',
  notes:
    "Filter by region and category using the filterRegion and filterCategory params. Use pageNum for pagination (0-indexed). Results are fresh trending data from TikTok's Inspiration ranking.",
  input: z.object({
    csrfToken: z.string().describe('CSRF token from getContext()'),
    deviceId: z.string().describe('Device ID from getContext()'),
    region: z.string().describe('Region from getContext()'),
    language: z.string().describe('Language from getContext()'),
    filterRegion: TrendingRegionSchema.optional()
      .default('All')
      .describe(
        'Region to filter trending content by. Default: All (global trending).',
      ),
    filterCategory: TrendingCategorySchema.optional()
      .default('All')
      .describe('Content category to filter by. Default: All categories.'),
    pageNum: z
      .number()
      .optional()
      .default(0)
      .describe('Page number for pagination (0-indexed). Default: 0.'),
    pageSize: z
      .number()
      .optional()
      .default(12)
      .describe('Number of posts per page. Default: 12.'),
  }),
  output: z.object({
    posts: z
      .array(
        z.object({
          itemId: z.string().describe('Post item ID'),
          title: z.string().describe('Post title/description'),
          authorUniqueId: z.string().describe('Author username/handle'),
          authorNickName: z.string().describe('Author display name'),
          authorSecUid: z.string().describe('Author secure user ID'),
          coverUrl: z.string().describe('Post thumbnail/cover URL'),
          playCount: z.number().describe('Total view count'),
          likeCount: z.number().describe('Total like count'),
          playAddress: z
            .string()
            .optional()
            .describe(
              'Video playback URL (first URL from play address list). Absent if TikTok does not expose playback for this video.',
            ),
        }),
      )
      .describe('Trending video posts'),
    totalCount: z.number().describe('Total number of trending posts available'),
    hasMore: z.boolean().describe('Whether more pages exist'),
    pageNum: z.number().describe('Current page number returned'),
  }),
};

export type GetTrendingPostsInput = z.infer<
  typeof getTrendingPostsSchema.input
>;
export type GetTrendingPostsOutput = z.infer<
  typeof getTrendingPostsSchema.output
>;

export const getTrendingSoundsSchema = {
  name: 'getTrendingSounds',
  description:
    'Get trending sounds/music from the TikTok Creator Sound Library. Returns popular tracks sorted by usage count (how many TikTok videos currently use the sound).',
  notes:
    'Uses 1-indexed pagination (pageNum starts at 1). Sound library contains royalty-free tracks available for use in TikTok videos.',
  input: z.object({
    csrfToken: z.string().describe('CSRF token from getContext()'),
    deviceId: z.string().describe('Device ID from getContext()'),
    region: z.string().describe('Region from getContext()'),
    language: z.string().describe('Language from getContext()'),
    pageNum: z
      .number()
      .optional()
      .default(1)
      .describe('Page number for pagination (1-indexed). Default: 1.'),
    pageSize: z
      .number()
      .optional()
      .default(20)
      .describe('Number of sounds per page. Default: 20.'),
  }),
  output: z.object({
    sounds: z
      .array(
        z.object({
          id: z.string().describe('Sound/music ID string'),
          title: z.string().describe('Track title'),
          author: z.string().describe('Track author/artist name'),
          duration: z.number().describe('Track duration in seconds'),
          language: z
            .string()
            .describe('Track language code (e.g., "English", "non_vocal")'),
          userCount: z
            .number()
            .describe('Number of TikTok videos using this sound'),
          coverUrl: z
            .string()
            .optional()
            .describe('Cover image URL for the track'),
          playUrl: z
            .string()
            .optional()
            .describe('Playback URL for the track preview'),
        }),
      )
      .describe('Trending sound tracks'),
    total: z.number().describe('Total number of trending sounds available'),
    hasMore: z
      .boolean()
      .describe('Whether more sounds exist for the next page'),
  }),
};

export type GetTrendingSoundsInput = z.infer<
  typeof getTrendingSoundsSchema.input
>;
export type GetTrendingSoundsOutput = z.infer<
  typeof getTrendingSoundsSchema.output
>;

export const getTrendingHashtagsSchema = {
  name: 'getTrendingHashtags',
  description:
    'Get trending hashtags/topics from TikTok with view counts and trend trajectories. Returns topics currently trending on TikTok, filterable by region and content category. Includes score history to show whether a topic is rising or peaking.',
  notes:
    'Uses cursor-based pagination; pass cursor value from previous response for next page (unlike getTrendingPosts which uses pageNum). Start with cursor=0.',
  input: z.object({
    csrfToken: z.string().describe('CSRF token from getContext()'),
    deviceId: z.string().describe('Device ID from getContext()'),
    region: z.string().describe('Region from getContext()'),
    language: z.string().describe('Language from getContext()'),
    filterRegion: TrendingRegionSchema.optional()
      .default('All')
      .describe(
        'Region to filter trending hashtags by. Default: All (global trending).',
      ),
    filterCategory: TrendingCategorySchema.optional()
      .default('All')
      .describe('Content category to filter by. Default: All categories.'),
    count: z
      .number()
      .optional()
      .default(15)
      .describe('Number of trending hashtags to return. Default: 15.'),
    cursor: z
      .number()
      .optional()
      .default(0)
      .describe(
        'Pagination cursor (pass cursor value from previous response). Default: 0.',
      ),
  }),
  output: z.object({
    hashtags: z
      .array(
        z.object({
          id: z.string().describe('Hashtag/topic ID'),
          title: z.string().describe('Hashtag name (without #)'),
          viewCount: z
            .number()
            .describe('Total view count for videos using this hashtag'),
          rank: z
            .number()
            .describe('Current trending rank position (lower = more trending)'),
          description: z.string().describe('Brief description of the topic'),
          coverUrl: z.string().describe('Cover image URL for the topic'),
          scoreHistory: z
            .array(
              z.object({
                timestamp: z.number().describe('Unix timestamp'),
                value: z
                  .number()
                  .describe('Trending score value at this timestamp'),
              }),
            )
            .describe(
              'Historical trending score series showing recent trend trajectory',
            ),
          relatedVideos: z
            .array(
              z.object({
                itemId: z.string().describe('Related video item ID'),
                title: z.string().describe('Related video title'),
                likeCount: z.number().describe('Like count for related video'),
                playCount: z.number().describe('View count for related video'),
              }),
            )
            .describe('Sample videos currently using this hashtag'),
        }),
      )
      .describe('Trending hashtags/topics'),
    total: z.number().describe('Total number of trending hashtags available'),
    hasMore: z
      .boolean()
      .describe('Whether more hashtags exist for the next cursor'),
    cursor: z.number().describe('Cursor value to pass for the next page'),
  }),
};

export type GetTrendingHashtagsInput = z.infer<
  typeof getTrendingHashtagsSchema.input
>;
export type GetTrendingHashtagsOutput = z.infer<
  typeof getTrendingHashtagsSchema.output
>;

// ============================================================================
// Profile
// ============================================================================

export const getProfileSchema = {
  name: 'getProfile',
  description:
    "Get the authenticated user's TikTok profile info: username, display name, bio, avatar, and verification status.",
  notes:
    "Returns profile data for the currently authenticated user only; cannot fetch other users' profiles.",
  input: z.object({
    csrfToken: z.string().describe('CSRF token from getContext()'),
    deviceId: z.string().describe('Device ID from getContext()'),
    region: z.string().describe('Region from getContext()'),
    language: z.string().describe('Language from getContext()'),
  }),
  output: z.object({
    uid: z.string().describe('Numeric user ID'),
    secUid: z.string().describe('Secure user ID (base64-encoded)'),
    uniqueId: z.string().describe('Username/handle'),
    nickName: z.string().describe('Display name'),
    bio: z.string().describe('Profile biography/description'),
    pronouns: z.string().describe('Display pronouns (may be empty)'),
    avatarUrl: z.string().describe('Profile avatar URL'),
    isVerified: z
      .boolean()
      .describe('Whether account has certification/verification'),
    isPrivate: z.boolean().describe('Whether account is private'),
    region: z.string().describe('Account region code'),
    language: z.string().describe('Account language setting'),
  }),
};

export type GetProfileInput = z.infer<typeof getProfileSchema.input>;
export type GetProfileOutput = z.infer<typeof getProfileSchema.output>;

export const updateProfileSchema = {
  name: 'updateProfile',
  description:
    'Update profile fields: display name (nickName) and/or bio (signature). Only provide fields you want to change.',
  notes:
    'Only nickName and signature (bio) are supported for text updates via this function. Avatar and cover image changes require the TikTok mobile app.',
  input: z.object({
    csrfToken: z.string().describe('CSRF token from getContext()'),
    deviceId: z.string().describe('Device ID from getContext()'),
    region: z.string().describe('Region from getContext()'),
    language: z.string().describe('Language from getContext()'),
    nickName: z
      .string()
      .optional()
      .describe('New display name. Leave undefined to keep current name.'),
    bio: z
      .string()
      .optional()
      .describe('New biography/bio text. Leave undefined to keep current bio.'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the update succeeded'),
  }),
};

export type UpdateProfileInput = z.infer<typeof updateProfileSchema.input>;
export type UpdateProfileOutput = z.infer<typeof updateProfileSchema.output>;

// ============================================================================
// Monetization
// ============================================================================

export const MonetizationProgramSchema = z.object({
  name: z
    .string()
    .describe('Program name (e.g., "Creator Rewards Program", "Subscription")'),
  m10nProject: z
    .number()
    .describe(
      'Program type code: 1=Video Gifts, 5=Creator Marketplace, 9=Creator Rewards, 13=Subscription',
    ),
  description: z.string().describe('Program description'),
  requirementsMet: z
    .number()
    .describe('Number of eligibility requirements the account currently meets'),
  totalRequirements: z
    .number()
    .describe('Total number of requirements needed for eligibility'),
  isEligible: z
    .boolean()
    .describe('Whether the account is currently eligible to enroll'),
  ctaText: z
    .string()
    .describe(
      'Current call-to-action text shown on the program card (e.g., "Learn more", "Join")',
    ),
});

export type MonetizationProgram = z.infer<typeof MonetizationProgramSchema>;

export const getEarningsSchema = {
  name: 'getEarnings',
  description:
    'Get Creator Rewards Program earnings summary: total earnings per period (7/30/60 days) and daily estimated income history.',
  notes:
    'Returns $0.00 for accounts not enrolled in Creator Rewards Program. Earnings data covers the last 60 days by default.',
  input: z.object({
    csrfToken: z.string().describe('CSRF token from getContext()'),
    deviceId: z.string().describe('Device ID from getContext()'),
    region: z.string().describe('Region from getContext()'),
    language: z.string().describe('Language from getContext()'),
  }),
  output: z.object({
    currency: z.string().describe('Currency code (e.g., "USD")'),
    sevenDayTotal: z
      .string()
      .describe('Total earnings in last 7 days (formatted, e.g., "$12.34")'),
    thirtyDayTotal: z
      .string()
      .describe('Total earnings in last 30 days (formatted, e.g., "$45.67")'),
    sixtyDayTotal: z
      .string()
      .describe('Total earnings in last 60 days (formatted, e.g., "$89.01")'),
    sevenDayChangePercent: z
      .number()
      .describe(
        'Percent change vs previous 7-day period (positive = up, negative = down)',
      ),
    thirtyDayChangePercent: z
      .number()
      .describe('Percent change vs previous 30-day period'),
    sixtyDayChangePercent: z
      .number()
      .describe('Percent change vs previous 60-day period'),
    dailyHistory: z
      .array(
        z.object({
          time: z.number().describe('Unix timestamp for this day'),
          amount: z
            .string()
            .describe('Formatted earnings amount (e.g., "$0.00")'),
          amountRaw: z.number().describe('Raw earnings in currency units'),
        }),
      )
      .describe(
        'Daily estimated income history (last ~60 days, most recent last)',
      ),
  }),
};

export type GetEarningsInput = z.infer<typeof getEarningsSchema.input>;
export type GetEarningsOutput = z.infer<typeof getEarningsSchema.output>;

export const getMonetizationStatusSchema = {
  name: 'getMonetizationStatus',
  description:
    'Get which monetization programs the creator is eligible for and their enrollment status. Programs include Creator Rewards, Subscriptions, Creator Marketplace, and Video Gifts.',
  notes:
    'requirementsMet vs totalRequirements shows how close the account is to eligibility. isEligible=false means the account does not yet meet all requirements.',
  input: z.object({
    csrfToken: z.string().describe('CSRF token from getContext()'),
    deviceId: z.string().describe('Device ID from getContext()'),
    region: z.string().describe('Region from getContext()'),
    language: z.string().describe('Language from getContext()'),
  }),
  output: z.object({
    programs: z
      .array(MonetizationProgramSchema)
      .describe(
        'List of available monetization programs with eligibility status',
      ),
  }),
};

export type GetMonetizationStatusInput = z.infer<
  typeof getMonetizationStatusSchema.input
>;
export type GetMonetizationStatusOutput = z.infer<
  typeof getMonetizationStatusSchema.output
>;

// ============================================================================
// Content Management
// ============================================================================

export const DetailedPostSchema = z.object({
  itemId: z.string().describe('Unique post/item ID'),
  desc: z.string().describe('Post description/caption'),
  createTime: z.number().describe('Post creation timestamp (Unix seconds)'),
  postTime: z.number().describe('Post publish timestamp (Unix seconds)'),
  duration: z.number().describe('Video duration in seconds'),
  stats: z
    .object({
      playCount: z.number().describe('Total view count'),
      diggCount: z.number().describe('Total like count'),
      commentCount: z.number().describe('Total comment count'),
      shareCount: z.number().describe('Total share count'),
      collectCount: z.number().describe('Total save/favorite count'),
    })
    .describe('Post engagement statistics'),
  coverUrl: z.string().describe('Cover image URL'),
  videoUrl: z.string().describe('Video URL'),
  status: z
    .number()
    .describe('Post status code: 0=public, 1=private, 2=friends only.'),
  isScheduled: z.boolean().describe('Whether post is scheduled for future'),
  scheduledPublishTime: z
    .number()
    .optional()
    .describe('Scheduled publish time (Unix seconds), if scheduled'),
});

export type DetailedPost = z.infer<typeof DetailedPostSchema>;

export const getPostSchema = {
  name: 'getPost',
  description:
    'Get detailed information for a single published or scheduled post including full engagement metrics, description, and privacy settings.',
  notes:
    'Returns null if post not found or does not belong to the authenticated user.',
  input: z.object({
    csrfToken: z.string().describe('CSRF token from getContext()'),
    deviceId: z.string().describe('Device ID from getContext()'),
    region: z.string().describe('Region from getContext()'),
    language: z.string().describe('Language from getContext()'),
    itemId: z.string().describe('Post item ID to fetch'),
  }),
  output: z.object({
    post: DetailedPostSchema.nullable().describe(
      'Post details, or null if not found',
    ),
  }),
};

export type GetPostInput = z.infer<typeof getPostSchema.input>;
export type GetPostOutput = z.infer<typeof getPostSchema.output>;

export const DraftSchema = z.object({
  itemId: z.string().describe('Draft item ID'),
  desc: z.string().describe('Draft caption/description (may be empty)'),
  createTime: z.number().describe('Draft creation timestamp (Unix seconds)'),
  duration: z.number().describe('Video duration in seconds'),
  coverUrl: z.string().describe('Cover image URL'),
});

export type Draft = z.infer<typeof DraftSchema>;

export const listDraftsSchema = {
  name: 'listDrafts',
  description:
    'Get all draft posts stored in TikTok Studio: videos that have been saved but not yet published.',
  notes: 'Returns empty array if no drafts exist.',
  input: z.object({
    csrfToken: z.string().describe('CSRF token from getContext()'),
    deviceId: z.string().describe('Device ID from getContext()'),
    region: z.string().describe('Region from getContext()'),
    language: z.string().describe('Language from getContext()'),
  }),
  output: z.object({
    drafts: z.array(DraftSchema).describe('List of draft posts'),
    totalFetched: z.number().describe('Total number of drafts fetched'),
  }),
};

export type ListDraftsInput = z.infer<typeof listDraftsSchema.input>;
export type ListDraftsOutput = z.infer<typeof listDraftsSchema.output>;

export const deletePostSchema = {
  name: 'deletePost',
  description:
    'Delete a published or scheduled post. This action is permanent and cannot be undone.',
  notes:
    'Returns success even if the post does not exist (idempotent). Use listPosts to confirm deletion.',
  input: z.object({
    csrfToken: z.string().describe('CSRF token from getContext()'),
    deviceId: z.string().describe('Device ID from getContext()'),
    region: z.string().describe('Region from getContext()'),
    language: z.string().describe('Language from getContext()'),
    itemId: z.string().describe('Post item ID to delete'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the delete request succeeded'),
  }),
};

export type DeletePostInput = z.infer<typeof deletePostSchema.input>;
export type DeletePostOutput = z.infer<typeof deletePostSchema.output>;

export const updatePostSchema = {
  name: 'updatePost',
  description:
    'Edit post settings after publishing: caption, privacy level (who can view), comment settings, and duet/stitch toggles.',
  notes:
    'Only include fields you want to change. Privacy level codes differ from post status codes: 0=public, 1=followers only, 2=friends only, 3=private.',
  input: z.object({
    csrfToken: z.string().describe('CSRF token from getContext()'),
    deviceId: z.string().describe('Device ID from getContext()'),
    region: z.string().describe('Region from getContext()'),
    language: z.string().describe('Language from getContext()'),
    itemId: z.string().describe('Post item ID to update'),
    desc: z
      .string()
      .optional()
      .describe('New caption/description. Leave undefined to keep current.'),
    privacyLevel: z
      .number()
      .optional()
      .describe(
        'Privacy level: 0=public, 1=followers only, 2=friends only, 3=private. Leave undefined to keep current.',
      ),
    allowComment: z
      .boolean()
      .optional()
      .describe('Whether to allow comments. Leave undefined to keep current.'),
    allowDuet: z
      .boolean()
      .optional()
      .describe('Whether to allow duets. Leave undefined to keep current.'),
    allowStitch: z
      .boolean()
      .optional()
      .describe('Whether to allow stitches. Leave undefined to keep current.'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the update succeeded'),
  }),
};

export type UpdatePostInput = z.infer<typeof updatePostSchema.input>;
export type UpdatePostOutput = z.infer<typeof updatePostSchema.output>;

// ============================================================================
// All Schemas
// ============================================================================

export const allSchemas = [
  getContextSchema,
  listPostsSchema,
  getAccountAnalyticsSchema,
  getPostAnalyticsSchema,
  getAudienceInsightsSchema,
  getFollowerGrowthSchema,
  getTopPostsSchema,
  listCommentsSchema,
  getCommentCountSchema,
  replyToCommentSchema,
  deleteCommentSchema,
  deleteCommentsSchema,
  pinCommentSchema,
  unpinCommentSchema,
  getTrendingPostsSchema,
  getTrendingSoundsSchema,
  getTrendingHashtagsSchema,
  getProfileSchema,
  updateProfileSchema,
  getEarningsSchema,
  getMonetizationStatusSchema,
  getPostSchema,
  listDraftsSchema,
  deletePostSchema,
  updatePostSchema,
];
