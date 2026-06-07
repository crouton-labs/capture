/**
 * Facebook Library
 *
 * Browser-executable functions for Facebook's Comet web GraphQL endpoint.
 * Flat per-domain layout (index-{domain}.ts + schemas-{domain}.ts) to match
 * the Instagram sibling library.
 */

export { getContext } from './context';

export {
  listHomeFeed,
  getCachedFeedItem,
  listStories,
  getRightSideCards,
  getMegaphone,
  getPostPermalink,
} from './index-feed';

export {
  listFriendsContent,
  getFriendRequestBadgeCount,
  markFriendsBadgeRead,
  sendFriendRequest,
} from './index-friends';

export {
  listMarketplaceFeed,
  getMarketplaceListing,
  getMarketplaceListingImages,
  saveMarketplaceListing,
  unsaveMarketplaceListing,
  listMarketplaceNotifications,
  getMarketplaceCategories,
  getMarketplaceBadgeCount,
} from './index-marketplace';

export {
  listVideoFeed,
  getVideoEntrypoint,
  getWatchBadgeCount,
} from './index-video';

export {
  listGroups,
  listGroupFeed,
  discoverGroups,
  listJoinedGroups,
  getGroupsBadgeCount,
} from './index-groups';

export { listNotifications } from './index-notifications';

export {
  listActivityLog,
  getActivityLogViewer,
  curateActivityLogItem,
} from './index-activity';

export {
  listContacts,
  listContactChannels,
  listCommunityChats,
  listContactGroups,
} from './index-messaging';

export {
  getBootstrapKeywords,
  searchAll,
  searchPeople,
  getKeywordSuggestions,
  recordTypeaheadSelection,
} from './index-search';

export {
  getProfileHovercard,
  getProfileHeader,
  getProfileTopSection,
  getProfileAbout,
  listProfilePosts,
  getProfileTimelineListView,
  listProfilePhotos,
  listProfileSection,
  getProfileCollection,
  listProfileFriends,
} from './index-profile';

export { getPhoto, getPhotoTags } from './index-photo';

export {
  searchLocations,
  searchHubs,
  listProfilePictureCandidates,
  listCoverPhotoCandidates,
  updateCurrentCity,
  updateHometown,
  updateRelationshipStatus,
  setProfilePicture,
  setCoverPhoto,
  addEducationExperience,
} from './index-account';

export {
  createComment,
  reactToFeedback,
  listReactors,
  getReactionsSummary,
  getReactorsByImportance,
  getReactionTooltip,
  startTypingComment,
  stopTypingComment,
  getMentionSuggestions,
} from './index-comments';

export { createShareUrl, getShareLinkPreview } from './index-share';

export { createPhotoStory } from './index-stories';

export { createPost, searchPlaces } from './index-compose';
