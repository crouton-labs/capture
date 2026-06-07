/**
 * Instagram Library
 *
 * Browser-executable functions for Instagram's web APIs.
 * Multi-file structure: each domain in its own index-{domain}.ts.
 */

// Re-export all functions from domain modules
export { getContext } from './index-core';
export { getDirectInbox, getDirectThread } from './index-dm';
export { getFeed, getExplore } from './index-feed';
export {
  getUserProfile,
  resolveUsername,
  getBusinessContact,
  getUserPosts,
  getUserReels,
  getUserTagged,
  getOwnProfile,
} from './index-profile';
export {
  getStoriesTray,
  getHighlights,
  getStoryArchive,
} from './index-stories';
export {
  getPendingFollowRequests,
  acceptFollowRequest,
  getActivityFeed,
} from './index-notifications';
export {
  getInboxTray,
  getSearchSuggestions,
  getViewerSettings,
  unsendMessage,
} from './index-misc';
export {
  getThreadInfo,
  getMessageReactions,
  sendMessage,
  sendNewMessage,
} from './index-dm-ext';
export {
  likePost,
  unlikePost,
  commentOnPost,
  deleteComment,
} from './index-engagement';
export {
  followUser,
  unfollowUser,
  rejectFollowRequest,
  getUserFollowers,
  getUserFollowing,
} from './index-relationships';
export {
  searchUsers,
  getPostDetail,
  getSavedPosts,
  getSuggestedUsers,
  getHashtagFeed,
  getLocationFeed,
} from './index-content';
export { createPost, deletePost } from './index-publish';
export { getPostComments, getPostLikers } from './index-engagement-read';
