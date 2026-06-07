import { z } from 'zod';

import { CsrfParam } from './schemas-common';

// ============================================================================
// getUserProfile
// ============================================================================

export const UserProfileSchema = z.object({
  userId: z.string().describe('Numeric user ID'),
  username: z.string().describe('Username/handle'),
  fullName: z.string().describe('Display name'),
  biography: z.string().describe('Profile bio text'),
  profilePicUrl: z.string().describe('Profile picture URL (HD)'),
  followerCount: z.number().describe('Number of followers'),
  followingCount: z.number().describe('Number of accounts followed'),
  postCount: z.number().describe('Number of posts'),
  isVerified: z.boolean().describe('Whether account is verified'),
  isPrivate: z.boolean().describe('Whether account is private'),
  externalUrl: z.string().nullable().describe('External website URL from bio'),
  category: z.string().nullable().describe('Business/creator category label'),
  isBusiness: z.boolean().describe('Whether account is a business account'),
  isProfessionalAccount: z
    .boolean()
    .describe('Whether account is a professional (creator/business) account'),
  pronouns: z.array(z.string()).describe('User pronouns (e.g. ["he/him"])'),
});

export type UserProfile = z.infer<typeof UserProfileSchema>;

export const getUserProfileSchema = {
  name: 'getUserProfile',
  description:
    "Get a user's profile data by username or numeric user ID: bio, follower/following counts, post count, verification status, and profile picture.",
  notes:
    'Provide exactly one of `username` or `userId`. Prefer `username` (the common @handle) — it resolves directly via web_profile_info. Use `userId` when you only have a numeric ID (e.g. from DM participants or getSearchSuggestions). To get just the numeric id for a handle, use resolveUsername.',
  input: z.object({
    csrf: CsrfParam,
    username: z
      .string()
      .optional()
      .describe('Instagram username/handle without @ (provide this OR userId)'),
    userId: z
      .string()
      .optional()
      .describe('Numeric user ID to look up (provide this OR username)'),
  }),
  output: UserProfileSchema,
};

export type GetUserProfileInput = z.infer<typeof getUserProfileSchema.input>;
export type GetUserProfileOutput = z.infer<typeof getUserProfileSchema.output>;

// ============================================================================
// resolveUsername
// ============================================================================

export const ResolvedUserSchema = z.object({
  userId: z.string().describe('Numeric user ID (pk)'),
  username: z.string().describe('Canonical username/handle'),
  fullName: z.string().describe('Display name'),
  isPrivate: z.boolean().describe('Whether the account is private'),
  isVerified: z.boolean().describe('Whether the account is verified'),
});

export type ResolvedUser = z.infer<typeof ResolvedUserSchema>;

export const resolveUsernameSchema = {
  name: 'resolveUsername',
  description:
    'Resolve an Instagram username/handle to its numeric user ID (plus basic identity: display name, private/verified flags).',
  notes:
    'The bridge between handle-based and ID-based functions. Many functions (getUserReels, getUserTagged, getHighlights, getSuggestedUsers, getUserFollowers, getUserFollowing) require a numeric userId, but users are usually known by @handle — call this first to get the userId. For the full profile (counts, bio, etc.) call getUserProfile directly with a username instead.',
  input: z.object({
    csrf: CsrfParam,
    username: z.string().describe('Instagram username/handle without @'),
  }),
  output: ResolvedUserSchema,
};

export type ResolveUsernameInput = z.infer<typeof resolveUsernameSchema.input>;
export type ResolveUsernameOutput = z.infer<
  typeof resolveUsernameSchema.output
>;

// ============================================================================
// getBusinessContact
// ============================================================================

export const ContactInfoSchema = z.object({
  userId: z.string().describe('Numeric user ID (pk)'),
  username: z.string().describe('Username/handle'),
  fullName: z.string().describe('Display name'),
  isBusiness: z.boolean().describe('Whether this is a business account'),
  isProfessional: z
    .boolean()
    .describe('Whether this is a professional (creator/business) account'),
  category: z.string().nullable().describe('Business/creator category label'),
  publicEmail: z
    .string()
    .nullable()
    .describe('Public contact email (null/empty when not shown)'),
  publicPhoneNumber: z
    .string()
    .nullable()
    .describe('Public phone number (national format, no country code)'),
  publicPhoneCountryCode: z
    .string()
    .nullable()
    .describe('Country code for the public phone number'),
  contactPhoneNumber: z
    .string()
    .nullable()
    .describe('Full contact phone number including country code'),
  contactMethod: z
    .string()
    .nullable()
    .describe('Preferred contact button type: CALL, TEXT, EMAIL, or UNKNOWN'),
  address: z
    .object({
      street: z.string().nullable().describe('Street address'),
      cityName: z.string().nullable().describe('City name'),
      zip: z.string().nullable().describe('Postal/ZIP code'),
      latitude: z.number().nullable().describe('Latitude'),
      longitude: z.number().nullable().describe('Longitude'),
    })
    .describe('Public business address (fields null when not set)'),
  additionalAddressCount: z
    .number()
    .describe('Number of additional business addresses beyond the primary one'),
  externalUrl: z
    .string()
    .nullable()
    .describe('External website URL from the bio'),
  bioLinks: z
    .array(
      z.object({
        title: z.string().describe('Link display title'),
        url: z.string().describe('Link URL'),
      }),
    )
    .describe('All bio links (linktrees/sites) — the real outbound prospecting links'),
});

export type ContactInfo = z.infer<typeof ContactInfoSchema>;

export const getBusinessContactSchema = {
  name: 'getBusinessContact',
  description:
    'Get the public contact details a creator/business account exposes: email, phone, address, contact-button method, category, and all bio links. Lead-enrichment / prospecting helper.',
  notes:
    "Provide exactly one of `username` or `userId`. Reads the /info/ endpoint, which exposes more contact fields than the public profile (phone, address, public email). NOTE: Instagram only returns email/phone the account chose to make public — fields are commonly empty; bioLinks and externalUrl are the most reliably populated.",
  input: z.object({
    csrf: CsrfParam,
    username: z
      .string()
      .optional()
      .describe('Instagram username/handle without @ (provide this OR userId)'),
    userId: z
      .string()
      .optional()
      .describe('Numeric user ID (provide this OR username)'),
  }),
  output: ContactInfoSchema,
};

export type GetBusinessContactInput = z.infer<
  typeof getBusinessContactSchema.input
>;
export type GetBusinessContactOutput = z.infer<
  typeof getBusinessContactSchema.output
>;

// ============================================================================
// Shared Media Node Schema
// ============================================================================

export const MediaNodeSchema = z.object({
  id: z.string().describe('Media post numeric ID'),
  shortcode: z
    .string()
    .describe('Short code used in post URL (instagram.com/p/{shortcode}/)'),
  displayUrl: z.string().describe('Primary image display URL'),
  caption: z
    .string()
    .nullable()
    .describe('Post caption text (null if no caption)'),
  likeCount: z.number().describe('Number of likes'),
  commentCount: z.number().describe('Number of comments'),
  takenAt: z.number().describe('Post creation timestamp (Unix seconds)'),
  isVideo: z.boolean().describe('Whether this post is a video'),
  videoViewCount: z
    .number()
    .nullable()
    .describe('View count for videos (null for images)'),
  accessibilityCaption: z
    .string()
    .nullable()
    .describe('Auto-generated accessibility caption'),
});

export type MediaNode = z.infer<typeof MediaNodeSchema>;

// ============================================================================
// getUserPosts
// ============================================================================

export const getUserPostsSchema = {
  name: 'getUserPosts',
  description:
    "Get a user's posts grid by username; returns post images, captions, like/comment counts.",
  notes:
    'Fetches the default posts tab (not reels). Takes username (not numeric user ID). For reels, use getUserReels.',
  input: z.object({
    csrf: CsrfParam,
    username: z.string().describe('Instagram username (without @)'),
    count: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(12)
      .describe('Number of posts to fetch (default 12, max 50)'),
  }),
  output: z.object({
    posts: z
      .array(MediaNodeSchema)
      .describe('Posts from the user profile grid'),
    totalCount: z.number().describe('Number of posts returned'),
    hasMore: z
      .boolean()
      .describe(
        'Whether more posts exist (cursor-based pagination not yet supported)',
      ),
  }),
};

export type GetUserPostsInput = z.infer<typeof getUserPostsSchema.input>;
export type GetUserPostsOutput = z.infer<typeof getUserPostsSchema.output>;

// ============================================================================
// getUserReels
// ============================================================================

export const getUserReelsSchema = {
  name: 'getUserReels',
  description:
    "Get a user's reels tab content by numeric user ID; returns reel videos with view and like counts.",
  notes:
    'Takes numeric user ID (not username). Get a userId from getUserProfile (by username), DM participants, or getSearchSuggestions. Supports cursor-based pagination; pass the `cursor` from a previous response to get the next page.',
  input: z.object({
    csrf: CsrfParam,
    userId: z.string().describe('Numeric user ID'),
    pageSize: z
      .number()
      .int()
      .min(1)
      .max(12)
      .default(12)
      .describe('Number of reels to fetch (default 12, server caps at 12)'),
    cursor: z
      .string()
      .optional()
      .describe(
        'Pagination cursor from a previous response (end_cursor). Omit for the first page.',
      ),
    includeFeedVideo: z
      .boolean()
      .optional()
      .describe(
        'Include feed videos in reels results (default true). Set to false for reels-only content.',
      ),
  }),
  output: z.object({
    reels: z.array(MediaNodeSchema).describe('Reels from the user reels tab'),
    totalCount: z.number().describe('Number of reels returned'),
    hasMore: z.boolean().describe('Whether more reels exist'),
    cursor: z
      .string()
      .nullable()
      .describe('Cursor for fetching the next page (null if no more pages)'),
  }),
};

export type GetUserReelsInput = z.infer<typeof getUserReelsSchema.input>;
export type GetUserReelsOutput = z.infer<typeof getUserReelsSchema.output>;

// ============================================================================
// getUserTagged
// ============================================================================

export const getUserTaggedSchema = {
  name: 'getUserTagged',
  description:
    'Get posts a user is tagged in by numeric user ID; returns the tagged tab media grid.',
  notes:
    'Takes numeric user ID (not username). Get a userId from getUserProfile (by username). Returns empty array for private accounts or users with no tagged posts. Supports cursor-based pagination via the cursor param (pass cursor from previous response). Note: takenAt is always 0 for tagged posts (the API does not return post timestamps for this endpoint).',
  input: z.object({
    csrf: CsrfParam,
    userId: z.string().describe('Numeric user ID'),
    count: z
      .number()
      .int()
      .min(1)
      .max(12)
      .optional()
      .describe(
        'Number of tagged posts to fetch (1-12, default 12). Instagram caps at 12 per page.',
      ),
    cursor: z
      .string()
      .optional()
      .describe(
        'Pagination cursor from previous response (end_cursor). Omit for first page.',
      ),
  }),
  output: z.object({
    posts: z.array(MediaNodeSchema).describe('Posts the user is tagged in'),
    totalCount: z.number().describe('Number of tagged posts returned'),
    hasMore: z.boolean().describe('Whether more tagged posts exist'),
    cursor: z
      .string()
      .nullable()
      .describe(
        'Cursor for next page (pass as cursor param). Null when no more pages.',
      ),
  }),
};

export type GetUserTaggedInput = z.infer<typeof getUserTaggedSchema.input>;
export type GetUserTaggedOutput = z.infer<typeof getUserTaggedSchema.output>;

// ============================================================================
// getOwnProfile
// ============================================================================

export const BioLinkSchema = z.object({
  title: z.string().describe('Display title for the link'),
  url: z.string().describe('Link URL'),
});

export type BioLink = z.infer<typeof BioLinkSchema>;

export const ProfileEditParamsEntrySchema = z.object({
  shouldShowConfirmationDialog: z
    .boolean()
    .describe('Whether changing this field requires confirmation'),
  isPendingReview: z
    .boolean()
    .describe('Whether a pending change is under review'),
  confirmationDialogText: z
    .string()
    .describe('Text shown in confirmation dialog'),
  disclaimerText: z.string().describe('Disclaimer text for the field'),
});

export type ProfileEditParamsEntry = z.infer<
  typeof ProfileEditParamsEntrySchema
>;

export const OwnProfileSchema = z.object({
  username: z.string().describe('Current username'),
  firstName: z.string().describe('First/display name'),
  lastName: z.string().describe('Last name (empty string if not set)'),
  biography: z.string().describe('Profile bio text'),
  externalUrl: z
    .string()
    .describe('Website URL from bio (empty string if not set)'),
  bioLinks: z
    .array(BioLinkSchema)
    .describe('Bio links for web editing (may be empty)'),
  email: z.string().describe('Account email address'),
  isEmailConfirmed: z
    .boolean()
    .describe('Whether the email address is confirmed'),
  phoneNumber: z.string().describe('Phone number (empty string if not set)'),
  isPhoneConfirmed: z
    .boolean()
    .describe('Whether the phone number is confirmed'),
  gender: z
    .number()
    .describe(
      'Gender code: 1=Male, 2=Female, 3=Custom, 0/empty=Prefer not to say',
    ),
  customGender: z
    .string()
    .describe('Custom gender text (only set when gender=3)'),
  birthday: z
    .string()
    .nullable()
    .describe('Birthday in YYYY-MM-DD format (null if not set)'),
  chainingEnabled: z
    .boolean()
    .describe('Whether "Show account suggestions on profiles" is enabled'),
  presenceDisabled: z
    .boolean()
    .describe('Whether activity presence (online status) is hidden'),
  businessAccount: z.boolean().describe('Whether this is a business account'),
  usertagReviewEnabled: z
    .boolean()
    .describe(
      'Whether user manually reviews tags before they appear on profile',
    ),
  trustedUsername: z
    .string()
    .nullable()
    .describe(
      'Trusted username for verified accounts (null if not applicable)',
    ),
  trustDays: z
    .number()
    .nullable()
    .describe(
      'Trust period in days for verified accounts (null if not applicable)',
    ),
  profileEditParams: z
    .object({
      username: ProfileEditParamsEntrySchema.describe(
        'Edit constraints for username changes',
      ),
      fullName: ProfileEditParamsEntrySchema.describe(
        'Edit constraints for name changes',
      ),
    })
    .describe(
      'Metadata about editing restrictions for username and name fields',
    ),
});

export type OwnProfile = z.infer<typeof OwnProfileSchema>;

export const getOwnProfileSchema = {
  name: 'getOwnProfile',
  description:
    "Get the authenticated user's own profile edit form data: name, bio, website, email, phone, and gender.",
  notes:
    'Takes no auth params; reads from browser cookies automatically. Returns editable profile fields for the authenticated user only.',
  input: z.object({}),
  output: OwnProfileSchema,
};

export type GetOwnProfileOutput = z.infer<typeof getOwnProfileSchema.output>;

// ============================================================================
// All Profile Schemas (for merge into allSchemas)
// ============================================================================

export const allProfileSchemas = [
  getUserProfileSchema,
  resolveUsernameSchema,
  getBusinessContactSchema,
  getUserPostsSchema,
  getUserReelsSchema,
  getUserTaggedSchema,
  getOwnProfileSchema,
];
