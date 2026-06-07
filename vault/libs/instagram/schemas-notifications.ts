import { z } from 'zod';

import { CsrfParam } from './schemas-common';

// ============================================================================
// getPendingFollowRequests
// ============================================================================

export const PendingFollowRequestSchema = z.object({
  userId: z.string().describe('User ID of the requester'),
  username: z.string().describe('Username of the requester'),
  fullName: z.string().describe('Display name of the requester'),
  profilePicUrl: z.string().describe('Profile picture URL'),
  isVerified: z.boolean().describe('Whether the account is verified'),
  isPrivate: z.boolean().describe('Whether the account is private'),
});

export type PendingFollowRequest = z.infer<typeof PendingFollowRequestSchema>;

export const FollowRequestSuggestedUserSchema = z.object({
  userId: z.string().describe('User ID of the suggested user'),
  username: z.string().describe('Username of the suggested user'),
  fullName: z.string().describe('Display name of the suggested user'),
  profilePicUrl: z.string().describe('Profile picture URL'),
  isVerified: z.boolean().describe('Whether the account is verified'),
  isPrivate: z.boolean().describe('Whether the account is private'),
});

export type FollowRequestSuggestedUser = z.infer<
  typeof FollowRequestSuggestedUserSchema
>;

export const getPendingFollowRequestsSchema = {
  name: 'getPendingFollowRequests',
  description:
    'Get pending follow requests for the authenticated user (only relevant for private accounts).',
  notes:
    'Returns an empty list for public accounts. Supports cursor-based pagination via maxId; pass the nextMaxId from a previous response to fetch the next page. Also returns suggested users and a ranking token for follow request ordering.',
  input: z.object({
    csrf: CsrfParam,
    maxId: z
      .string()
      .optional()
      .describe(
        'Pagination cursor from a previous response (nextMaxId field). Omit for the first page.',
      ),
    count: z
      .number()
      .optional()
      .describe(
        'Maximum number of follow requests to return per page. Controls page size for paginated results.',
      ),
  }),
  output: z.object({
    requests: z
      .array(PendingFollowRequestSchema)
      .describe('Pending follow requests'),
    totalCount: z
      .number()
      .describe('Number of pending requests returned in this page'),
    nextMaxId: z
      .string()
      .nullable()
      .describe(
        'Cursor for fetching the next page (pass as maxId). Null when no more pages.',
      ),
    bigList: z
      .boolean()
      .describe(
        'Whether the full list is paginated (true when there are more pages)',
      ),
    pageSize: z
      .number()
      .describe('Number of results the API returned for this page'),
    followRankingToken: z
      .string()
      .nullable()
      .describe(
        'Ranking token for follow request ordering (format: uuid|userId|type). Null when not available.',
      ),
    truncateFollowRequestsAtIndex: z
      .number()
      .nullable()
      .describe(
        'Index at which the UI should truncate the follow requests list (typically 5). Null when not returned.',
      ),
    suggestedUsers: z
      .array(FollowRequestSuggestedUserSchema)
      .describe('Suggested users returned alongside follow requests'),
  }),
};

export type GetPendingFollowRequestsInput = z.infer<
  typeof getPendingFollowRequestsSchema.input
>;
export type GetPendingFollowRequestsOutput = z.infer<
  typeof getPendingFollowRequestsSchema.output
>;

// ============================================================================
// acceptFollowRequest
// ============================================================================

export const acceptFollowRequestSchema = {
  name: 'acceptFollowRequest',
  description: 'Accept a pending follow request from a user by their user ID.',
  notes:
    'Only relevant for private accounts. Use getPendingFollowRequests to get userId values.',
  input: z.object({
    csrf: CsrfParam,
    userId: z.string().describe('User ID of the requester to accept'),
    hasSeenUkOsaPrompt: z
      .boolean()
      .optional()
      .describe(
        'Whether the user has seen the UK Online Safety Act compliance prompt before accepting. Defaults to false.',
      ),
  }),
  output: z.object({
    success: z
      .boolean()
      .describe('Whether the request was accepted successfully'),
    friendshipStatus: z
      .object({
        following: z
          .boolean()
          .describe('Whether the authenticated user is following them'),
        followedBy: z
          .boolean()
          .describe('Whether they are now following the authenticated user'),
        blocking: z
          .boolean()
          .describe('Whether the authenticated user is blocking them'),
        isPrivate: z.boolean().describe('Whether their account is private'),
      })
      .describe('Updated friendship status after acceptance'),
  }),
};

export type AcceptFollowRequestInput = z.infer<
  typeof acceptFollowRequestSchema.input
>;
export type AcceptFollowRequestOutput = z.infer<
  typeof acceptFollowRequestSchema.output
>;

// ============================================================================
// getActivityFeed
// ============================================================================

export const ActivityFeedCountsSchema = z.object({
  usertags: z.number().describe('Count of user tag notifications'),
  campaign_notification: z
    .number()
    .describe('Count of campaign notification items'),
  activity_feed_dot_badge_only: z
    .number()
    .describe('Badge-only activity feed dot count'),
  promotional: z.number().describe('Count of promotional notifications'),
  comment_likes: z.number().describe('Count of comment like notifications'),
  new_posts: z.number().describe('Count of new post notifications'),
  shopping_notification: z
    .number()
    .describe('Count of shopping-related notifications'),
  comments: z.number().describe('Count of comment notifications'),
  activity_feed_dot_badge: z
    .number()
    .describe('Total activity feed dot badge count'),
  fundraiser: z.number().describe('Count of fundraiser-related notifications'),
  relationships: z
    .number()
    .describe('Count of relationship (follow/unfollow) notifications'),
  likes: z.number().describe('Count of like notifications'),
  media_to_approve: z
    .number()
    .describe('Count of media items pending approval'),
  photos_of_you: z.number().describe('Count of photos-of-you notifications'),
  requests: z
    .number()
    .describe('Count of pending follow request notifications'),
});

export type ActivityFeedCounts = z.infer<typeof ActivityFeedCountsSchema>;

export const ActivityStorySchema = z.object({
  pk: z.string().describe('Primary key identifier for the story item'),
  notifName: z
    .string()
    .describe('Machine-readable notification name (e.g. "like", "comment")'),
  type: z.number().describe('Numeric story type discriminator'),
  text: z
    .string()
    .describe(
      'Human-readable notification text (rich_text if available, falls back to text)',
    ),
  destination: z
    .string()
    .describe('Deep-link destination URL for the notification'),
  iconUrl: z.string().describe('URL of the notification icon image'),
  timestamp: z
    .number()
    .describe('Unix timestamp (seconds) when the notification was generated'),
  aggregationType: z
    .string()
    .describe(
      'How the notification was aggregated (e.g. "none", "grouped_by_media")',
    ),
});

export type ActivityStory = z.infer<typeof ActivityStorySchema>;

export const getActivityFeedSchema = {
  name: 'getActivityFeed',
  description:
    'Fetch the Instagram activity/notifications feed (likes, comments, follows, tags, etc.) for the authenticated user.',
  notes:
    'Calls POST /api/v1/news/inbox/ and auto-paginates via continuation_token/max_id until is_last_page is true (capped at 10 pages). Returns counts of unread notification categories alongside a flat normalised stories array combining new_stories and old_stories. Requires a valid csrftoken cookie; derive csrf via getContext() or read directly from document.cookie.',
  input: z.object({
    csrf: CsrfParam,
    maxPages: z
      .number()
      .optional()
      .describe(
        'Maximum number of pages to fetch (default 10). Each page corresponds to one POST to /api/v1/news/inbox/ with a max_id cursor.',
      ),
  }),
  output: z.object({
    counts: ActivityFeedCountsSchema.describe(
      'Per-category unread notification counts returned by the API',
    ),
    stories: z
      .array(ActivityStorySchema)
      .describe(
        'Flat list of all activity stories (new + old), normalised from raw story items',
      ),
    continuationToken: z
      .number()
      .nullable()
      .describe(
        'Continuation token from the last page fetched. Null when is_last_page is true or no token was returned.',
      ),
    isLastPage: z
      .boolean()
      .describe(
        'Whether the last fetched page was the final page of results (is_last_page from the API)',
      ),
  }),
};

export type GetActivityFeedInput = z.infer<
  typeof getActivityFeedSchema.input
>;
export type GetActivityFeedOutput = z.infer<
  typeof getActivityFeedSchema.output
>;

// ============================================================================
// All Schemas
// ============================================================================

export const allNotificationsSchemas = [
  getPendingFollowRequestsSchema,
  acceptFollowRequestSchema,
  getActivityFeedSchema,
];
