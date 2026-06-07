import { getContextSchema } from './schemas-common';

export * from './schemas-common';
export * from './schemas-feed';
export * from './schemas-friends';
export * from './schemas-marketplace';
export * from './schemas-video';
export * from './schemas-groups';
export * from './schemas-notifications';
export * from './schemas-activity';
export * from './schemas-messaging';
export * from './schemas-search';
export * from './schemas-profile';
export * from './schemas-photo';
export * from './schemas-account';
export * from './schemas-comments';
export * from './schemas-share';
export * from './schemas-stories';
export * from './schemas-compose';

import {
  listHomeFeedSchema,
  getCachedFeedItemSchema,
  listStoriesSchema,
  getRightSideCardsSchema,
  getMegaphoneSchema,
  getPostPermalinkSchema,
} from './schemas-feed';
import {
  listFriendsContentSchema,
  getFriendRequestBadgeCountSchema,
  markFriendsBadgeReadSchema,
  sendFriendRequestSchema,
} from './schemas-friends';
import {
  listMarketplaceFeedSchema,
  getMarketplaceListingSchema,
  getMarketplaceListingImagesSchema,
  saveMarketplaceListingSchema,
  unsaveMarketplaceListingSchema,
  listMarketplaceNotificationsSchema,
  getMarketplaceCategoriesSchema,
  getMarketplaceBadgeCountSchema,
} from './schemas-marketplace';
import {
  listVideoFeedSchema,
  getVideoEntrypointSchema,
  getWatchBadgeCountSchema,
} from './schemas-video';
import {
  listGroupsSchema,
  listGroupFeedSchema,
  discoverGroupsSchema,
  listJoinedGroupsSchema,
  getGroupsBadgeCountSchema,
} from './schemas-groups';
import { listNotificationsSchema } from './schemas-notifications';
import {
  listActivityLogSchema,
  getActivityLogViewerSchema,
  curateActivityLogItemSchema,
} from './schemas-activity';
import {
  listContactsSchema,
  listContactChannelsSchema,
  listCommunityChatsSchema,
  listContactGroupsSchema,
} from './schemas-messaging';
import {
  getBootstrapKeywordsSchema,
  searchAllSchema,
  searchPeopleSchema,
  getKeywordSuggestionsSchema,
  recordTypeaheadSelectionSchema,
} from './schemas-search';
import {
  getProfileHovercardSchema,
  getProfileHeaderSchema,
  getProfileTopSectionSchema,
  getProfileAboutSchema,
  listProfilePostsSchema,
  getProfileTimelineListViewSchema,
  listProfilePhotosSchema,
  listProfileSectionSchema,
  getProfileCollectionSchema,
  listProfileFriendsSchema,
} from './schemas-profile';
import { getPhotoSchema, getPhotoTagsSchema } from './schemas-photo';
import {
  searchLocationsSchema,
  searchHubsSchema,
  listProfilePictureCandidatesSchema,
  listCoverPhotoCandidatesSchema,
  updateCurrentCitySchema,
  updateHometownSchema,
  updateRelationshipStatusSchema,
  setProfilePictureSchema,
  setCoverPhotoSchema,
  addEducationExperienceSchema,
} from './schemas-account';
import {
  createCommentSchema,
  reactToFeedbackSchema,
  listReactorsSchema,
  getReactionsSummarySchema,
  getReactorsByImportanceSchema,
  getReactionTooltipSchema,
  startTypingCommentSchema,
  stopTypingCommentSchema,
  getMentionSuggestionsSchema,
} from './schemas-comments';
import {
  createShareUrlSchema,
  getShareLinkPreviewSchema,
} from './schemas-share';
import { createPhotoStorySchema } from './schemas-stories';
import { createPostSchema, searchPlacesSchema } from './schemas-compose';

export const libraryDescription =
  "Facebook (facebook.com, FB, Meta's social network) — reach for this library whenever the user mentions Facebook or asks to do anything on Facebook: their News Feed, profile, posts, photos, friends, groups, Marketplace, Reels/Watch, notifications, activity log, or Messenger contact sidebar. Covers feed browsing and post permalinks, profile reads and viewer-only profile edits (current city, hometown, relationship status, profile/cover photo, education), friend list and friend requests, Marketplace browse + listing detail + save/unsave, Reels/Watch feed, joined groups + group feed, notifications, activity log, Messenger contact sidebar (read-only — no live messaging), global people/page/group search, commenting, reacting (Like/Love/Care/Haha/Wow/Sad/Angry), share-link generation, posting a photo to Stories, and creating top-level News Feed posts. Live Messenger send/receive is not exposed.";

export const libraryIcon = '/icons/libs/facebook.png';
export const loginUrl = 'https://www.facebook.com';

export const libraryNotes = `
## Workflow

1. Navigate to \`https://www.facebook.com\` and ensure the viewer is logged in.
2. Call \`getContext()\` once to verify the session and capture \`{ userId, fbDtsg, lsd, asbdId, origin }\`.
3. Call any other function. Auth tokens are re-read from the Meta module system on every call, so rotation during a session is handled transparently; no token parameter is passed per call.

## Key Concepts

- **Persisted queries**: Every call is a persisted Relay GraphQL query identified by a numeric \`doc_id\` paired with a \`fb_api_req_friendly_name\`. The pair is fixed in this library and rotates only when Facebook redeploys. If a call starts returning 400/empty, the \`doc_id\` has likely rotated and needs to be recaptured from live traffic.
- **Response format**: Responses arrive with \`Content-Type: text/html\` but the body is JSON. Relay incremental delivery is used for feed queries; the response is newline-delimited JSON chunks merged into a single \`data\` tree before return, so streamed edges and deferred fields appear inline.
- **Unstructured outputs**: Most function outputs are \`passthrough\` — raw Relay payloads under a \`data\` key. Entity shapes vary by domain (e.g. \`data.viewer.news_feed.edges\`, \`data.marketplace_product_details_page\`). Consumers should navigate the returned tree.
- **Story ids vs target ids (Marketplace)**: \`targetId\` is the numeric listing id used by \`getMarketplaceListing\`. \`storyId\` is the base64-ish token (\`UzpfSTxxx:VK:yyy\`) used by save/unsave mutations and is found inside the PDP response.
- **Gaps**: Full Messenger send/receive is not captured in the source HARs and is not exposed. Messenger realtime runs over MQTT on \`wss://edge-chat.facebook.com\` and is out of scope for this HTTP library. The composer photo-upload endpoint that mints \`photo.id\` for \`createPost({ photoIds })\` and \`createPhotoStory\` attachments is exposed only for Stories; \`createPost\` requires pre-existing photo ids until a HAR captures the inline-composer upload flow.
- **Anti-scraping**: Requests carry \`x-asbd-id\`, \`x-fb-lsd\`, and a \`jazoest\` checksum computed from \`fb_dtsg\`. These are all read/derived from the page at call time. The opaque Relay state blobs (\`__csr\`, \`__dyn\`, \`__hblp\`, \`__sjsp\`) are omitted; Facebook accepts the request without them.

## Pagination

Facebook uses opaque cursor pagination. List endpoints that support it accept a nullable \`cursor\` param and return a new cursor inside the response (usually at \`data.*.page_info.end_cursor\`). Pass that value as \`cursor\` on the next call.

## Profile reads

Profile functions take numeric \`userID\` only — they do not accept vanity slugs like \`MichaelHanchao\`. Sources of userID:
- \`listFriendsContent\`: friend list with ids
- \`listContacts\`: messaging-sidebar contacts with ids
- \`searchAll\`: each result has \`entityId\` for users / pages
- \`getProfileHovercard\`: takes \`entityID\` (also a userID) and enriches it

Section / collection tokens (\`sectionToken\`, \`collectionToken\`, \`appSectionFeedKey\`) required by \`getProfileAbout\`, \`listProfileSection\`, \`getProfileCollection\`, \`listProfileFriends\` are minted server-side via Facebook's SPA router. The library handles this transparently — callers only pass \`userID\` plus an optional \`tabKey\` / \`collectionKey\` slug (e.g. \`"about"\`, \`"friends_all"\`). Use \`getProfileHeader\` to discover available tabs and their slugs at \`response.sections[].tab_key\` and \`response.sections[].all_collections.nodes[].tab_key\`.

## Account writes (viewer's own profile)

Edit functions act on the authenticated viewer's own profile only — there is no userID parameter. Privacy defaults to public (EVERYONE).

The mutation inputs require server-resolved ids, not free text. Resolve first, then mutate:

- **Current city / hometown** → call \`searchLocations({ query })\`, pass \`results[].id\` as \`cityId\` to \`updateCurrentCity\` / \`updateHometown\`.
- **Education** → call \`searchHubs({ section: "COLLEGE", query })\`, pass \`results[].id\` as \`schoolId\` to \`addEducationExperience\`. For majors, call \`searchHubs({ section: "CONCENTRATION", query })\`.
- **Profile picture / cover photo** → call \`listProfilePictureCandidates()\` / \`listCoverPhotoCandidates()\`, pass \`mediaSets[].photos[].id\` as \`photoId\` to \`setProfilePicture\` / \`setCoverPhoto\`. These set an existing photo; uploading a new image is not exposed.

Section/collection tokens for the about-tab edits are minted automatically — callers don't pass them.

## Comments, reactions, sharing (UFI)

Every post/photo/video carries a \`feedback\` object whose \`id\` is a base64 token (\`feedback:{...}\`). That \`feedbackId\` is the universal target for comment + reaction operations:

- **Read a post with its comments**: \`getPostPermalink({ storyID })\` — \`storyID\` is the \`UzpfS...\` token from \`listHomeFeed\` (\`items[].storyID\`). The response includes \`feedback.id\` for the calls below.
- **Comment**: \`createComment({ feedbackId, text, messageRanges? })\`. To @-mention, call \`getMentionSuggestions()\` first and pass the entity \`id\` as \`messageRanges[].entity.id\`.
- **React**: \`reactToFeedback({ feedbackId, reaction })\` where \`reaction\` is one of LIKE / LOVE / CARE / HAHA / WOW / SAD / ANGRY. Numeric reaction ids are mapped internally.
- **Read reactors**: \`getReactionsSummary\` for tab counts; \`listReactors({ feedbackId, reaction?, cursor? })\` for paginated reactor users.
- **Delete own comment**: \`curateActivityLogItem({ action: "REMOVE_COMMENT", postId, storyId })\`. Source \`postId\` and \`storyId\` from \`listActivityLog({ category: "COMMENTS" })\`.
- **Share link**: \`createShareUrl({ originalUrl })\` returns a \`facebook.com/share/p/...\` short link. \`getShareLinkPreview({ url })\` returns the XMA card metadata.
`;

export const allSchemas = [
  getContextSchema,
  // Feed
  listHomeFeedSchema,
  getCachedFeedItemSchema,
  listStoriesSchema,
  getRightSideCardsSchema,
  getMegaphoneSchema,
  getPostPermalinkSchema,
  // Friends
  listFriendsContentSchema,
  getFriendRequestBadgeCountSchema,
  markFriendsBadgeReadSchema,
  sendFriendRequestSchema,
  // Marketplace
  listMarketplaceFeedSchema,
  getMarketplaceListingSchema,
  getMarketplaceListingImagesSchema,
  saveMarketplaceListingSchema,
  unsaveMarketplaceListingSchema,
  listMarketplaceNotificationsSchema,
  getMarketplaceCategoriesSchema,
  getMarketplaceBadgeCountSchema,
  // Video
  listVideoFeedSchema,
  getVideoEntrypointSchema,
  getWatchBadgeCountSchema,
  // Groups
  listGroupsSchema,
  listGroupFeedSchema,
  discoverGroupsSchema,
  listJoinedGroupsSchema,
  getGroupsBadgeCountSchema,
  // Notifications
  listNotificationsSchema,
  // Activity
  listActivityLogSchema,
  getActivityLogViewerSchema,
  curateActivityLogItemSchema,
  // Messaging
  listContactsSchema,
  listContactChannelsSchema,
  listCommunityChatsSchema,
  listContactGroupsSchema,
  // Search
  getBootstrapKeywordsSchema,
  searchAllSchema,
  searchPeopleSchema,
  getKeywordSuggestionsSchema,
  recordTypeaheadSelectionSchema,
  // Profile
  getProfileHovercardSchema,
  getProfileHeaderSchema,
  getProfileTopSectionSchema,
  getProfileAboutSchema,
  listProfilePostsSchema,
  getProfileTimelineListViewSchema,
  listProfilePhotosSchema,
  listProfileSectionSchema,
  getProfileCollectionSchema,
  listProfileFriendsSchema,
  // Photo
  getPhotoSchema,
  getPhotoTagsSchema,
  // Account (viewer's own profile edits)
  searchLocationsSchema,
  searchHubsSchema,
  listProfilePictureCandidatesSchema,
  listCoverPhotoCandidatesSchema,
  updateCurrentCitySchema,
  updateHometownSchema,
  updateRelationshipStatusSchema,
  setProfilePictureSchema,
  setCoverPhotoSchema,
  addEducationExperienceSchema,
  // Comments + reactions (UFI)
  createCommentSchema,
  reactToFeedbackSchema,
  listReactorsSchema,
  getReactionsSummarySchema,
  getReactorsByImportanceSchema,
  getReactionTooltipSchema,
  startTypingCommentSchema,
  stopTypingCommentSchema,
  getMentionSuggestionsSchema,
  // Sharing
  createShareUrlSchema,
  getShareLinkPreviewSchema,
  // Stories composer
  createPhotoStorySchema,
  // Feed composer
  createPostSchema,
  searchPlacesSchema,
];
