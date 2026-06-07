import { z } from 'zod';

import { CsrfParam } from './schemas-common';

// ============================================================================
// Shared
// ============================================================================

export const FriendshipStatusSchema = z.object({
  following: z
    .boolean()
    .describe('Whether the authenticated user is now following them'),
  followedBy: z
    .boolean()
    .describe('Whether they are following the authenticated user'),
  blocking: z
    .boolean()
    .describe('Whether the authenticated user is blocking them'),
  isPrivate: z.boolean().describe('Whether their account is private'),
  outgoingRequest: z
    .boolean()
    .optional()
    .describe('Whether a follow request is pending (for private accounts)'),
  incomingRequest: z
    .boolean()
    .optional()
    .describe(
      'Whether they have sent a follow request to the authenticated user',
    ),
  isBestie: z
    .boolean()
    .optional()
    .describe('Whether the user is in the close friends list'),
  isFeedFavorite: z
    .boolean()
    .optional()
    .describe('Whether the user is marked as a feed favorite'),
  isRestricted: z
    .boolean()
    .optional()
    .describe('Whether the user is restricted'),
  muting: z
    .boolean()
    .optional()
    .describe('Whether the authenticated user is muting them'),
  isEligibleToSubscribe: z
    .boolean()
    .optional()
    .describe('Whether the user is eligible for subscription'),
  subscribed: z
    .boolean()
    .optional()
    .describe('Whether the authenticated user is subscribed to them'),
});

export type FriendshipStatus = z.infer<typeof FriendshipStatusSchema>;

// ============================================================================
// followUser
// ============================================================================

export const followUserSchema = {
  name: 'followUser',
  description:
    'Follow a user by their user ID. For private accounts, this sends a follow request.',
  notes: 'Use getUserProfile to get the userId for a username.',
  input: z.object({
    csrf: CsrfParam,
    userId: z.string().describe('User ID of the account to follow'),
    containerModule: z
      .string()
      .optional()
      .describe(
        'Context where the follow action was triggered (e.g. "profile", "feed_timeline", "explore_popular", "self_profile", "reels_tab"). Defaults to "profile"',
      ),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the follow action succeeded'),
    friendshipStatus: FriendshipStatusSchema.describe(
      'Updated friendship status after following',
    ),
  }),
};

export type FollowUserInput = z.infer<typeof followUserSchema.input>;
export type FollowUserOutput = z.infer<typeof followUserSchema.output>;

// ============================================================================
// unfollowUser
// ============================================================================

export const unfollowUserSchema = {
  name: 'unfollowUser',
  description: 'Unfollow a user by their user ID.',
  notes: 'Use getUserProfile to get the userId for a username.',
  input: z.object({
    csrf: CsrfParam,
    userId: z.string().describe('User ID of the account to unfollow'),
    containerModule: z
      .string()
      .optional()
      .describe(
        'Context where the unfollow action was triggered (e.g. "profile", "feed_timeline", "self_profile"). Defaults to "profile"',
      ),
    navChain: z
      .string()
      .optional()
      .describe(
        'Navigation chain string describing the UI path. Defaults to "{containerModule}:{containerModule}:1:via_cold_start". The browser sends context-specific values like "PolarisFeedRoot:feedPage:1:via_cold_start" for feed_timeline',
      ),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the unfollow action succeeded'),
    friendshipStatus: FriendshipStatusSchema.describe(
      'Updated friendship status after unfollowing',
    ),
    previousFollowing: z
      .boolean()
      .optional()
      .describe('Whether the user was being followed before this action'),
  }),
};

export type UnfollowUserInput = z.infer<typeof unfollowUserSchema.input>;
export type UnfollowUserOutput = z.infer<typeof unfollowUserSchema.output>;

// ============================================================================
// rejectFollowRequest
// ============================================================================

export const rejectFollowRequestSchema = {
  name: 'rejectFollowRequest',
  description: 'Reject/ignore a pending follow request from a user.',
  notes:
    'Only relevant for private accounts. Use getPendingFollowRequests to get userId values.',
  input: z.object({
    csrf: CsrfParam,
    userId: z.string().describe('User ID of the requester to reject'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the follow request was rejected'),
    friendshipStatus: FriendshipStatusSchema.describe(
      'Updated friendship status after rejection',
    ),
  }),
};

export type RejectFollowRequestInput = z.infer<
  typeof rejectFollowRequestSchema.input
>;
export type RejectFollowRequestOutput = z.infer<
  typeof rejectFollowRequestSchema.output
>;

// ============================================================================
// getUserFollowers
// ============================================================================

export const FollowerUserSchema = z.object({
  userId: z.string().describe('Instagram user ID (pk)'),
  username: z.string().describe('Username'),
  fullName: z.string().describe('Display name'),
  isPrivate: z.boolean().describe('Whether account is private'),
  isVerified: z.boolean().describe('Whether account is verified'),
  profilePicUrl: z.string().describe('Profile picture URL'),
});

export type FollowerUser = z.infer<typeof FollowerUserSchema>;

export const getUserFollowersSchema = {
  name: 'getUserFollowers',
  description:
    'Get the list of users who follow a given user. Supports pagination for large follower lists.',
  notes:
    'Pass the userId (numeric string from getUserProfile or searchUsers). Returns up to `limit` followers per page (default 50, max ~200). Use `nextMaxId` from the response as the `maxId` param to fetch the next page.',
  input: z.object({
    csrf: CsrfParam,
    userId: z
      .string()
      .describe('Numeric user ID of the account whose followers to retrieve'),
    limit: z
      .number()
      .optional()
      .describe('Number of followers to return per page (default 50)'),
    maxId: z
      .string()
      .optional()
      .describe(
        'Pagination cursor from a previous response (nextMaxId). Omit for the first page.',
      ),
  }),
  output: z.object({
    users: z.array(FollowerUserSchema).describe('Followers on this page'),
    totalCount: z
      .number()
      .describe('Number of followers returned on this page'),
    hasMore: z
      .boolean()
      .describe('Whether more followers are available via pagination'),
    nextMaxId: z
      .string()
      .nullable()
      .describe('Cursor to pass as maxId for the next page (null if no more)'),
  }),
};

export type GetUserFollowersInput = z.infer<
  typeof getUserFollowersSchema.input
>;
export type GetUserFollowersOutput = z.infer<
  typeof getUserFollowersSchema.output
>;

// ============================================================================
// getUserFollowing
// ============================================================================

export const getUserFollowingSchema = {
  name: 'getUserFollowing',
  description:
    'Get the list of users that a given user follows. Supports pagination for large following lists.',
  notes:
    'Pass the userId (numeric string from getUserProfile or searchUsers). Returns up to `limit` users per page (default 50, max ~200). Use `nextMaxId` from the response as the `maxId` param to fetch the next page.',
  input: z.object({
    csrf: CsrfParam,
    userId: z
      .string()
      .describe(
        'Numeric user ID of the account whose following list to retrieve',
      ),
    limit: z
      .number()
      .optional()
      .describe('Number of users to return per page (default 50)'),
    maxId: z
      .string()
      .optional()
      .describe(
        'Pagination cursor from a previous response (nextMaxId). Omit for the first page.',
      ),
  }),
  output: z.object({
    users: z.array(FollowerUserSchema).describe('Following on this page'),
    totalCount: z.number().describe('Number of users returned on this page'),
    hasMore: z
      .boolean()
      .describe('Whether more users are available via pagination'),
    nextMaxId: z
      .string()
      .nullable()
      .describe('Cursor to pass as maxId for the next page (null if no more)'),
  }),
};

export type GetUserFollowingInput = z.infer<
  typeof getUserFollowingSchema.input
>;
export type GetUserFollowingOutput = z.infer<
  typeof getUserFollowingSchema.output
>;

// ============================================================================
// All Schemas
// ============================================================================

export const allRelationshipsSchemas = [
  followUserSchema,
  unfollowUserSchema,
  rejectFollowRequestSchema,
  getUserFollowersSchema,
  getUserFollowingSchema,
];
