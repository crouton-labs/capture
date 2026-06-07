// Shared params
export { CsrfParam } from './schemas-common';

// Re-export all domain schemas and types
export * from './schemas-core';
export * from './schemas-dm';
export * from './schemas-feed';
export * from './schemas-profile';
export * from './schemas-stories';
export * from './schemas-notifications';
export * from './schemas-misc';
export * from './schemas-dm-ext';
export * from './schemas-engagement';
export * from './schemas-relationships';
export * from './schemas-content';
export * from './schemas-publish';
export * from './schemas-engagement-read';

// Import schemas for allSchemas array
import { getContextSchema } from './schemas-core';
import { getDirectInboxSchema, getDirectThreadSchema } from './schemas-dm';
import { getFeedSchema, getExploreSchema } from './schemas-feed';
import {
  getUserProfileSchema,
  resolveUsernameSchema,
  getBusinessContactSchema,
  getUserPostsSchema,
  getUserReelsSchema,
  getUserTaggedSchema,
  getOwnProfileSchema,
} from './schemas-profile';
import {
  getStoriesTraySchema,
  getHighlightsSchema,
  getStoryArchiveSchema,
} from './schemas-stories';
import {
  getPendingFollowRequestsSchema,
  acceptFollowRequestSchema,
  getActivityFeedSchema,
} from './schemas-notifications';
import {
  getInboxTraySchema,
  getSearchSuggestionsSchema,
  getViewerSettingsSchema,
  unsendMessageSchema,
} from './schemas-misc';
import {
  getThreadInfoSchema,
  getMessageReactionsSchema,
  sendMessageSchema,
  sendNewMessageSchema,
} from './schemas-dm-ext';
import {
  likePostSchema,
  unlikePostSchema,
  commentOnPostSchema,
  deleteCommentSchema,
} from './schemas-engagement';
import {
  followUserSchema,
  unfollowUserSchema,
  rejectFollowRequestSchema,
  getUserFollowersSchema,
  getUserFollowingSchema,
} from './schemas-relationships';
import {
  searchUsersSchema,
  getPostDetailSchema,
  getSavedPostsSchema,
  getSuggestedUsersSchema,
  getHashtagFeedSchema,
  getLocationFeedSchema,
} from './schemas-content';
import { createPostSchema, deletePostSchema } from './schemas-publish';
import {
  getPostCommentsSchema,
  getPostLikersSchema,
} from './schemas-engagement-read';

// ============================================================================
// Library Metadata
// ============================================================================

export const libraryDescription =
  'Instagram operations: DMs, profiles, and feed via internal web APIs';

export const libraryIcon = '/icons/libs/instagram.png';
export const loginUrl = 'https://www.instagram.com';

export const libraryNotes = `
## Workflow

1. Navigate to \`https://www.instagram.com\`
2. Call \`getContext()\` to get \`{ csrf, userId, username, appId, deviceId, ajaxVersion, claimToken }\`
3. Pass \`csrf\` to functions that require it (most functions). Some functions (getDirectThread, getOwnProfile) read auth from browser cookies automatically and take no csrf param.

## Key Concepts

- **User IDs vs Usernames**: Some endpoints take numeric user IDs (userId/pk), others take usernames. getContext returns your own userId. getUserProfile returns userId for any account.
- **Thread IDs**: Two formats exist: threadId (39-digit numeric string) and threadKey (short numeric string). getDirectInbox returns both. getDirectThread, getThreadInfo, and getMessageReactions take the short threadKey, NOT the 39-digit threadId. **sendMessage is different**: it needs the threadFbid from getThreadInfo, so the send path is getDirectInbox → getThreadInfo (read threadFbid) → sendMessage. Passing the wrong identifier silently returns empty.
- **Sender ID in DMs**: Messages report the sender's Instagram user ID (igid), which matches userId in participants and getContext().userId for the authenticated user.
- **Media IDs**: Numeric post IDs used for engagement actions (like, comment). Available from getUserPosts, getFeed, and getPostDetail.
- **Shortcodes**: URL-friendly post identifiers (instagram.com/p/{shortcode}/). Use for getPostDetail.

## Categories

- **DMs**: Inbox, threads, thread info, message reactions, send/unsend messages
- **Engagement**: Like/unlike posts, comment/delete comments
- **Relationships**: Follow/unfollow users, accept/reject follow requests, list followers/following
- **Content**: Search users/hashtags/places, post details, saved posts, suggested users
- **Profiles**: User profiles, posts, reels, tagged posts
- **Stories**: Stories tray, highlights, archive
- **Notifications**: Activity feed, pending follow requests

## Pagination

Cursor-based: pass \`cursor\` (or \`nextMaxId\` for explore/archive/saved) from the previous response to get the next page. Not all functions support pagination.
`;

// ============================================================================
// Rate Limits
// ============================================================================

// Instagram action-blocks FAR more aggressively than X/LinkedIn — bursts of
// follows/likes/comments/DMs trigger temporary "Action Blocked" / checkpoint
// challenges within minutes, and the block lands on the ACCOUNT, not the call.
// (Confirmed live Jun 2026: a small paced write slice on a throwaway tripped a
// soft-block that broke subsequent reads too.) Caps below are deliberately
// conservative — well under commonly-cited 2024-26 web/unverified ceilings —
// because the cost of a wrong guess is a locked account, not a failed call.
// The MINUTE caps are the human-pacing layer that actually prevents flags.
// Enforced at runtime via `globalThis.vallum.rateLimit.check()` (northlight-agent).
export const rateLimits: Record<
  string,
  Array<{ window: 'MINUTE' | 'HOUR' | 'DAY'; maxCalls: number; message: string }>
> = {
  // Follows/unfollows are IG's #1 account-flag trigger.
  followUser: [
    { window: 'MINUTE', maxCalls: 3, message: 'Follow bursts are the top IG action-block trigger; keep human-paced' },
    { window: 'HOUR', maxCalls: 20, message: 'IG flags follow rate fast; stay well under' },
    { window: 'DAY', maxCalls: 150, message: 'Conservative daily follow ceiling for web/unverified accounts' },
  ],
  unfollowUser: [
    { window: 'MINUTE', maxCalls: 3, message: 'Mass-unfollow reads as aggressive automation' },
    { window: 'HOUR', maxCalls: 20, message: 'Shares the follow-rate guard' },
    { window: 'DAY', maxCalls: 150, message: 'Conservative daily unfollow ceiling' },
  ],
  // Likes are the most common automation signal; bursts soft-block quickly.
  likePost: [
    { window: 'MINUTE', maxCalls: 8, message: 'Like bursts are a top IG automation signal; pace them' },
    { window: 'HOUR', maxCalls: 100, message: 'Hourly like ceiling before a temp action-block' },
    { window: 'DAY', maxCalls: 300, message: 'Conservative daily like ceiling for web/unverified accounts' },
  ],
  unlikePost: [
    { window: 'MINUTE', maxCalls: 8, message: 'Shares the like budget; pace toggles' },
    { window: 'DAY', maxCalls: 300, message: 'Shares the daily like ceiling' },
  ],
  // Comments are heavily spam-scanned; even slow rates flag with repeated text.
  commentOnPost: [
    { window: 'MINUTE', maxCalls: 2, message: 'Comment bursts read as spam; pace to look human' },
    { window: 'HOUR', maxCalls: 15, message: 'Hourly comment ceiling before a spam flag' },
    { window: 'DAY', maxCalls: 100, message: 'Conservative daily comment ceiling; vary text to avoid spam detection' },
  ],
  deleteComment: [
    { window: 'MINUTE', maxCalls: 5, message: 'Pace comment deletions' },
    { window: 'DAY', maxCalls: 100, message: 'Shares the comment activity budget' },
  ],
  // DMs to non-mutuals are the fastest path to a spam flag on IG.
  sendMessage: [
    { window: 'MINUTE', maxCalls: 2, message: 'Pace DMs to look human; bursts read as spam' },
    { window: 'HOUR', maxCalls: 15, message: 'Hourly DM ceiling before a spam flag' },
    { window: 'DAY', maxCalls: 50, message: 'Conservative daily DM ceiling; IG flags new/non-mutual DMs hard' },
  ],
  sendNewMessage: [
    { window: 'MINUTE', maxCalls: 1, message: 'New-thread DMs to strangers flag fastest; one at a time' },
    { window: 'HOUR', maxCalls: 10, message: 'Hourly new-conversation ceiling' },
    { window: 'DAY', maxCalls: 30, message: 'Conservative daily new-conversation ceiling' },
  ],
  unsendMessage: [
    { window: 'MINUTE', maxCalls: 5, message: 'Pace message retractions' },
    { window: 'DAY', maxCalls: 50, message: 'Shares the DM activity budget' },
  ],
  // Follow-request responses are lower-risk but still account-state writes.
  acceptFollowRequest: [
    { window: 'MINUTE', maxCalls: 5, message: 'Pace follow-request responses' },
    { window: 'DAY', maxCalls: 200, message: 'Conservative daily ceiling for request handling' },
  ],
  rejectFollowRequest: [
    { window: 'MINUTE', maxCalls: 5, message: 'Pace follow-request responses' },
    { window: 'DAY', maxCalls: 200, message: 'Conservative daily ceiling for request handling' },
  ],
  // Publishing via web is sensitive; high frequency reads as bot posting.
  createPost: [
    { window: 'MINUTE', maxCalls: 1, message: 'Pace posts to look human; bursts trigger IG automation flags' },
    { window: 'HOUR', maxCalls: 5, message: 'Hourly post ceiling for web publishing' },
    { window: 'DAY', maxCalls: 15, message: 'Conservative daily original-post ceiling for web/unverified accounts' },
  ],
  deletePost: [
    { window: 'MINUTE', maxCalls: 2, message: 'Pace deletions' },
    { window: 'DAY', maxCalls: 25, message: 'Conservative daily deletion ceiling' },
  ],
  // Search abuse also flags; cap the rate.
  searchUsers: [
    { window: 'MINUTE', maxCalls: 20, message: 'Search rate ceiling to avoid abuse flags' },
  ],
  getSearchSuggestions: [
    { window: 'MINUTE', maxCalls: 20, message: 'Search rate ceiling to avoid abuse flags' },
  ],
};

// ============================================================================
// All Schemas (45 functions)
// ============================================================================

export const allSchemas = [
  // Core
  getContextSchema,
  // DM
  getDirectInboxSchema,
  getDirectThreadSchema,
  // Feed
  getFeedSchema,
  getExploreSchema,
  // Profile
  getUserProfileSchema,
  resolveUsernameSchema,
  getBusinessContactSchema,
  getUserPostsSchema,
  getUserReelsSchema,
  getUserTaggedSchema,
  getOwnProfileSchema,
  // Stories
  getStoriesTraySchema,
  getHighlightsSchema,
  getStoryArchiveSchema,
  // Notifications
  getPendingFollowRequestsSchema,
  acceptFollowRequestSchema,
  getActivityFeedSchema,
  // Misc
  getInboxTraySchema,
  getSearchSuggestionsSchema,
  getViewerSettingsSchema,
  unsendMessageSchema,
  // DM Extensions
  getThreadInfoSchema,
  getMessageReactionsSchema,
  sendMessageSchema,
  sendNewMessageSchema,
  // Engagement
  likePostSchema,
  unlikePostSchema,
  commentOnPostSchema,
  deleteCommentSchema,
  // Relationships
  followUserSchema,
  unfollowUserSchema,
  rejectFollowRequestSchema,
  getUserFollowersSchema,
  getUserFollowingSchema,
  // Content
  searchUsersSchema,
  getPostDetailSchema,
  getSavedPostsSchema,
  getSuggestedUsersSchema,
  getHashtagFeedSchema,
  getLocationFeedSchema,
  // Publish
  createPostSchema,
  deletePostSchema,
  // Engagement Read
  getPostCommentsSchema,
  getPostLikersSchema,
];
