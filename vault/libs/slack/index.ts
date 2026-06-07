/**
 * Slack Library - Browser-executable Slack operations via Web API
 *
 * This library is designed to run in a browser context via CDP,
 * operating on behalf of an authenticated user.
 */

// Re-export schemas for documentation
export * from './schemas';

// Context operations
export { getContext, getWorkspaces } from './context';

// Conversation operations
export {
  conversationsList,
  conversationsHistory,
  conversationsInfo,
  conversationsMembers,
  conversationsReplies,
  conversationsCreate,
  conversationsArchive,
  conversationsUnarchive,
  conversationsJoin,
  conversationsLeave,
  conversationsRename,
  conversationsOpen,
  conversationsClose,
  conversationsMark,
  conversationsSetPurpose,
  conversationsSetTopic,
  conversationsInvite,
  conversationsInviteShared,
} from './conversations';

// Message operations
export {
  chatPostMessage,
  chatUpdate,
  chatDelete,
  chatGetPermalink,
} from './messages';

// User operations
export {
  authTest,
  usersList,
  usersInfo,
  usersGetPresence,
  usersProfileGet,
  usersProfileSet,
  usersSetPresence,
  resolveDmCounterpart,
} from './users';

// Search operations
export {
  searchMessages,
  searchFiles,
  searchAll,
  searchChannels,
  searchPeople,
} from './search';

// File operations
export {
  filesList,
  filesInfo,
  filesUpload,
  filesDelete,
  filesGetUploadURLExternal,
  filesCompleteUploadExternal,
  uploadFile,
} from './files';

// Reaction operations
export { reactionsAdd, reactionsGet, reactionsRemove } from './reactions';

// Pin operations
export { pinsAdd, pinsList, pinsRemove } from './pins';

// Bookmark operations
export {
  bookmarksAdd,
  bookmarksList,
  bookmarksEdit,
  bookmarksRemove,
} from './bookmarks';

// DND operations
export {
  dndInfo,
  dndSetSnooze,
  dndEndSnooze,
  dndEndDnd,
  dndTeamInfo,
} from './dnd';

// Team operations
export { emojiList, teamInfo, botsInfo } from './team';

// Usergroup operations
export { usergroupsList, usergroupsUsersList } from './usergroups';
