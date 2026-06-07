import { z } from 'zod';

import { CsrfParam } from './schemas-common';

// ============================================================================
// getInboxTray
// ============================================================================

export const InboxTrayThreadSchema = z.object({
  threadId: z.string().describe('Thread ID (39-digit numeric string)'),
  threadKey: z.string().describe('Thread key (short numeric ID)'),
  threadTitle: z
    .string()
    .describe('Thread title (participant name or group name)'),
  isGroup: z.boolean().describe('Whether this is a group thread'),
  isUnread: z.boolean().describe('Whether the thread has unread messages'),
  lastActivityTimestamp: z
    .number()
    .describe('Last activity timestamp in milliseconds (Unix epoch)'),
  participants: z
    .array(
      z.object({
        userId: z.string().describe('Participant numeric user ID'),
        username: z.string().describe('Participant username'),
        profilePicUrl: z.string().describe('Participant profile picture URL'),
      }),
    )
    .describe('Thread participants'),
  lastMessageSnippet: z.string().describe('Short preview of the last message'),
  folder: z.string().describe('Thread folder assignment (e.g. "PRIMARY")'),
  isMuted: z
    .boolean()
    .describe('Whether notifications are muted for this thread'),
  isPinned: z.boolean().describe('Whether the thread is pinned to the top'),
  threadSubtype: z
    .string()
    .describe('Thread subtype (e.g. "IG_ONLY_ONE_TO_ONE")'),
});

export type InboxTrayThread = z.infer<typeof InboxTrayThreadSchema>;

export const getInboxTraySchema = {
  name: 'getInboxTray',
  description:
    'Get the DM inbox tray: a compact thread list with last message snippet, unread status, and participant info. Uses the GraphQL inbox endpoint. Returns threads sorted by most recent activity. Supports pagination via cursor.',
  notes:
    'First page uses PolarisDirectInboxQuery; subsequent pages use IGDThreadListOffMsysPaginationQuery with the cursor from the previous response. Default page size is 15 threads.',
  input: z.object({
    csrf: CsrfParam,
    cursor: z
      .string()
      .optional()
      .describe(
        "Pagination cursor from a previous response's nextCursor field. Omit for the first page.",
      ),
    count: z
      .number()
      .optional()
      .describe('Number of threads to fetch per page. Defaults to 15.'),
    folder: z
      .enum(['INBOX', 'BC_PARTNERSHIP'])
      .optional()
      .describe(
        'Which folder to fetch threads from. Defaults to "INBOX". "BC_PARTNERSHIP" is available for professional/business accounts.',
      ),
    newerThanTimestampMs: z
      .string()
      .optional()
      .describe(
        'Only return threads with activity newer than this Unix timestamp in milliseconds.',
      ),
  }),
  output: z.object({
    threads: z
      .array(InboxTrayThreadSchema)
      .describe('DM threads sorted by most recent activity'),
    totalCount: z.number().describe('Number of threads returned in this page'),
    hasMore: z
      .boolean()
      .describe('Whether more threads exist beyond those returned'),
    nextCursor: z
      .string()
      .nullable()
      .describe(
        'Cursor to pass as "cursor" for the next page. Null if no more pages.',
      ),
  }),
};

export type GetInboxTrayInput = z.infer<typeof getInboxTraySchema.input>;
export type GetInboxTrayOutput = z.infer<typeof getInboxTraySchema.output>;

// ============================================================================
// getSearchSuggestions
// ============================================================================

export const SearchSuggestionSchema = z.object({
  type: z
    .enum(['user', 'hashtag', 'place', 'keyword'])
    .describe('Item type based on which field is populated'),
  userId: z.string().nullable().describe('User ID / pk (for user items)'),
  username: z.string().nullable().describe('Username (for user items)'),
  fullName: z.string().nullable().describe('Full name (for user items)'),
  profilePicUrl: z
    .string()
    .nullable()
    .describe('Profile picture URL (for user items)'),
  hdProfilePicUrl: z
    .string()
    .nullable()
    .describe('HD profile picture URL (for user items, if available)'),
  isVerified: z
    .boolean()
    .describe('Whether the account is verified (for user items)'),
  socialContext: z
    .string()
    .nullable()
    .describe(
      'Social context snippet e.g. "Followed by X", "372M followers" (for user items)',
    ),
  isLiveBroadcasting: z
    .boolean()
    .describe(
      'Whether the user is currently live broadcasting (for user items)',
    ),
  hashtag: z
    .string()
    .nullable()
    .describe('Hashtag name without # (for hashtag items)'),
  hashtagMediaCount: z
    .number()
    .nullable()
    .describe('Number of posts using this hashtag (for hashtag items)'),
  hashtagSubtitle: z
    .string()
    .nullable()
    .describe('Subtitle text e.g. "5.8M posts" (for hashtag items)'),
  placeName: z
    .string()
    .nullable()
    .describe('Place/location name (for place items)'),
  placeSubtitle: z
    .string()
    .nullable()
    .describe('Place subtitle e.g. address or city (for place items)'),
  keyword: z
    .string()
    .nullable()
    .describe('Keyword text (for keyword items from "see more" results)'),
  searchQuery: z
    .string()
    .describe(
      'The search term for this suggestion (username, hashtag name, place name, or keyword)',
    ),
});

export type SearchSuggestion = z.infer<typeof SearchSuggestionSchema>;

export const getSearchSuggestionsSchema = {
  name: 'getSearchSuggestions',
  description:
    'Primary Instagram search: users, hashtags, and places with social context ("Followed by X", follower counts) and optional single-type filtering. Prefer this over searchUsers for richer results.',
  notes:
    'Backed by the GraphQL search-box query. Returns a blended list of users, hashtags, and places matching the query. Use the context param to restrict to a single result type. Results include social context (e.g. "Followed by X", "372M followers") for users. searchUsers is a lighter top-search alternative without social context.',
  input: z.object({
    csrf: CsrfParam,
    query: z
      .string()
      .describe(
        'Search query string; searches across users, hashtags, and places.',
      ),
    context: z
      .enum(['blended', 'user', 'hashtag', 'place', 'location'])
      .optional()
      .describe(
        'Search context filter. "blended" returns all types (default). "user"/"hashtag" restrict to that type. "place" and "location" both filter to places/locations.',
      ),
    searchSurface: z
      .enum(['web_top_search', 'web_search_page'])
      .optional()
      .describe(
        'Search surface identifier. "web_top_search" is the default search dropdown. "web_search_page" is the full search results page.',
      ),
    includeReel: z
      .boolean()
      .optional()
      .describe(
        'Whether to include reel/story ring data for user results. Defaults to true.',
      ),
  }),
  output: z.object({
    suggestions: z
      .array(SearchSuggestionSchema)
      .describe('Search result items ranked by relevance'),
    totalCount: z.number().describe('Number of suggestions returned'),
  }),
};

export type GetSearchSuggestionsInput = z.infer<
  typeof getSearchSuggestionsSchema.input
>;
export type GetSearchSuggestionsOutput = z.infer<
  typeof getSearchSuggestionsSchema.output
>;

// ============================================================================
// getViewerSettings
// ============================================================================

export const ViewerSettingsSchema = z.object({
  userId: z.string().describe('Authenticated user ID'),
  username: z.string().describe('Username/handle'),
  fullName: z.string().describe('Display name'),
  firstName: z.string().describe('First name (from edit profile form)'),
  lastName: z.string().describe('Last name (from edit profile form)'),
  email: z.string().nullable().describe('Account email address'),
  isEmailConfirmed: z
    .boolean()
    .describe('Whether the email address is confirmed'),
  phoneNumber: z.string().nullable().describe('Account phone number'),
  isPhoneConfirmed: z
    .boolean()
    .describe('Whether the phone number is confirmed'),
  isPrivate: z.boolean().describe('Whether the account is set to private'),
  isVerified: z.boolean().describe('Whether the account is verified'),
  biography: z.string().describe('Profile bio text'),
  externalUrl: z.string().nullable().describe('External website link from bio'),
  gender: z
    .number()
    .describe('Gender code: 1=Male, 2=Female, 3=Prefer not to say, 4=Custom'),
  customGender: z
    .string()
    .nullable()
    .describe('Custom gender text (when gender=4)'),
  birthday: z.string().nullable().describe('Birthday (YYYY-MM-DD, if set)'),
  profilePicUrl: z.string().describe('Profile picture URL'),
  isBusiness: z.boolean().describe('Whether account is a business account'),
  isProfessionalAccount: z
    .boolean()
    .describe('Whether account is a professional account'),
  category: z.string().nullable().describe('Business/creator category label'),
  chainingEnabled: z
    .boolean()
    .describe('Whether account suggestions are shown on profiles'),
  presenceDisabled: z
    .boolean()
    .describe('Whether activity status is hidden from others'),
  usertagReviewEnabled: z
    .boolean()
    .describe('Whether manual approval of tags is enabled'),
  fbBirthday: z
    .string()
    .nullable()
    .describe(
      'Facebook-linked birthday (YYYY-MM-DD). May differ from Instagram birthday.',
    ),
  bioLinks: z
    .array(
      z.object({
        url: z.string().describe('Link URL'),
        title: z.string().describe('Link display title'),
      }),
    )
    .describe(
      'Bio links configured on the profile (editable only via mobile app)',
    ),
  trustedUsername: z
    .string()
    .nullable()
    .describe('Trusted username for account recovery. Null if not set.'),
  trustDays: z
    .number()
    .nullable()
    .describe('Number of days the account has been trusted. Null if not set.'),
  isUsernamePendingReview: z
    .boolean()
    .describe('Whether a username change is currently pending review'),
  isFullNamePendingReview: z
    .boolean()
    .describe('Whether a full name change is currently pending review'),
  accountType: z
    .string()
    .nullable()
    .describe(
      'Account type from settings: "personal", "business", or "creator". Null if unavailable.',
    ),
  isSupervisionEnabled: z
    .boolean()
    .describe('Whether parental supervision is enabled on the account'),
  sensitiveContentControl: z
    .string()
    .nullable()
    .describe(
      'Sensitive content control level. "1" = default. Null if unavailable.',
    ),
});

export type ViewerSettings = z.infer<typeof ViewerSettingsSchema>;

export const getViewerSettingsSchema = {
  name: 'getViewerSettings',
  description:
    "Get the authenticated user's account settings including privacy, contact info, comment controls, and profile details.",
  notes:
    "Returns the currently logged-in user's editable profile settings via the REST form data endpoint. Includes fields not available in profile queries: email, phone, gender code, custom gender, chaining/presence/usertag settings.",
  input: z.object({
    csrf: CsrfParam,
  }),
  output: ViewerSettingsSchema,
};

export type GetViewerSettingsInput = z.infer<
  typeof getViewerSettingsSchema.input
>;
export type GetViewerSettingsOutput = z.infer<
  typeof getViewerSettingsSchema.output
>;

// ============================================================================
// unsendMessage
// ============================================================================

export const unsendMessageSchema = {
  name: 'unsendMessage',
  description:
    'Unsend (delete) a message from a DM thread. The message is removed for all participants.',
  notes:
    'Can only unsend messages sent by the authenticated user. The action is permanent and cannot be undone.',
  input: z.object({
    csrf: CsrfParam,
    messageId: z
      .string()
      .describe(
        'Message ID in mid.$ prefixed format from getDirectThread messages array',
      ),
    threadId: z
      .string()
      .describe(
        'Short numeric thread key from getDirectInbox.threadKey (NOT the 39-digit threadId)',
      ),
  }),
  output: z.object({
    success: z
      .boolean()
      .describe('Whether the message was successfully unsent'),
  }),
};

export type UnsendMessageInput = z.infer<typeof unsendMessageSchema.input>;
export type UnsendMessageOutput = z.infer<typeof unsendMessageSchema.output>;

// ============================================================================
// Export schemas for merge
// ============================================================================

export const allMiscSchemas = [
  getInboxTraySchema,
  getSearchSuggestionsSchema,
  getViewerSettingsSchema,
  unsendMessageSchema,
];
