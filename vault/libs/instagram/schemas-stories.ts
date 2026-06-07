import { z } from 'zod';

import { CsrfParam } from './schemas-common';

// ============================================================================
// Stories Tray
// ============================================================================

export const StoryTrayItemSchema = z.object({
  id: z.string().describe('Reel/story node ID (same as userId)'),
  userId: z.string().describe('User ID of the story author'),
  username: z.string().describe('Username of the story author'),
  fullName: z.string().describe('Full display name of the story author'),
  profilePicUrl: z.string().describe('Profile picture URL'),
  isVerified: z
    .boolean()
    .describe('Whether the story author has a verified badge'),
  isPrivate: z
    .boolean()
    .describe('Whether the story author has a private account'),
  latestReelMedia: z
    .number()
    .describe('Timestamp of the most recent story media'),
  expiringAt: z
    .number()
    .describe(
      'Unix timestamp when this story reel expires (24h after posting)',
    ),
  seen: z
    .number()
    .nullable()
    .describe(
      "Timestamp when viewer last saw this user's stories, null if never seen. 0 means story exists but has not been viewed.",
    ),
  hasUnseenStories: z.boolean().describe('Whether there are unseen stories'),
  mediaCount: z.number().describe('Number of story media items in this reel'),
  mediaIds: z
    .array(z.string())
    .describe('Media IDs of the individual story items'),
  reelType: z.string().describe('Type of reel (e.g. "user_reel")'),
  muted: z
    .boolean()
    .describe("Whether the viewer has muted this user's stories"),
  hasBestiesMedia: z
    .boolean()
    .describe('Whether the reel contains close friends media'),
  hasVideo: z
    .boolean()
    .describe('Whether any story item in this reel is a video'),
  canReply: z.boolean().describe('Whether the viewer can reply to this story'),
  canReshare: z.boolean().describe('Whether the viewer can reshare this story'),
});

export type StoryTrayItem = z.infer<typeof StoryTrayItemSchema>;

export const getStoriesTraySchema = {
  name: 'getStoriesTray',
  description:
    'Get the stories tray: the row of story circles at the top of the home feed showing who has active stories.',
  notes:
    'Returns only stories from accounts the user follows. Does not include suggested or recommended stories.',
  input: z.object({
    csrf: CsrfParam,
    reason: z
      .enum([
        'cold_start',
        'pull_to_refresh',
        'warm_start_with_feed',
        'pagination',
        'stale',
      ])
      .optional()
      .describe(
        'Reason for fetching the tray. Affects response metadata (e.g. cold_start includes btp_timestamps).',
      ),
    pageSize: z
      .number()
      .optional()
      .describe('Maximum number of story tray items to return. Omit for all.'),
  }),
  output: z.object({
    stories: z
      .array(StoryTrayItemSchema)
      .describe('Story tray items sorted by most recent activity'),
    totalCount: z.number().describe('Number of story tray items returned'),
    storyRankingToken: z
      .string()
      .nullable()
      .describe('Opaque ranking token for the current tray ordering'),
  }),
};

export type GetStoriesTrayInput = z.infer<typeof getStoriesTraySchema.input>;
export type GetStoriesTrayOutput = z.infer<typeof getStoriesTraySchema.output>;

// ============================================================================
// Story Highlights
// ============================================================================

export const HighlightCoverSchema = z.object({
  thumbnailSrc: z
    .string()
    .describe(
      'Cover image thumbnail URL (cropped 150x150 version preferred, falls back to full-size)',
    ),
});

export const HighlightSchema = z.object({
  id: z
    .string()
    .describe('Highlight reel numeric ID (e.g. "17983616051768088")'),
  title: z.string().describe('Highlight title/name'),
  coverMedia: HighlightCoverSchema.nullable().describe(
    'Cover image for the highlight, null if no cover set',
  ),
});

export type Highlight = z.infer<typeof HighlightSchema>;

export const getHighlightsSchema = {
  name: 'getHighlights',
  description:
    "Get a user's story highlights tray by user ID: the permanent highlight circles displayed below their bio on their profile page.",
  notes:
    'Takes a numeric user ID. Get user IDs from getUserProfile or DM thread participants. Returns all highlights at once (no pagination).',
  input: z.object({
    csrf: CsrfParam,
    userId: z.string().describe('Numeric user ID whose highlights to fetch'),
  }),
  output: z.object({
    highlights: z
      .array(HighlightSchema)
      .describe('Story highlights in display order'),
    totalCount: z.number().describe('Number of highlights returned'),
  }),
};

export type GetHighlightsInput = z.infer<typeof getHighlightsSchema.input>;
export type GetHighlightsOutput = z.infer<typeof getHighlightsSchema.output>;

// ============================================================================
// Story Archive
// ============================================================================

export const ArchiveItemSchema = z.object({
  id: z.string().describe('Media ID of the archived story'),
  mediaType: z.number().describe('Media type: 1=photo, 2=video'),
  thumbnailUrl: z.string().describe('Thumbnail image URL for the story'),
  takenAt: z.number().describe('Unix timestamp when the story was posted'),
  caption: z
    .string()
    .nullable()
    .describe('Story caption text, null if no caption'),
});

export type ArchiveItem = z.infer<typeof ArchiveItemSchema>;

export const getStoryArchiveSchema = {
  name: 'getStoryArchive',
  description:
    "Get the authenticated user's archived stories. Shows past stories saved in the story archive.",
  notes:
    'Only returns archived stories for the authenticated user (not other users). User must have story archive enabled in settings. Returns an empty items array if archive is empty or auto-archive is disabled.',
  input: z.object({
    csrf: CsrfParam,
    timezoneOffset: z
      .number()
      .optional()
      .default(-25200)
      .describe(
        'Timezone offset in seconds from UTC. Defaults to -25200 (UTC-7).',
      ),
    nextMaxId: z
      .string()
      .optional()
      .describe(
        "Pagination cursor from a previous response's maxId field. Pass to fetch older archived stories.",
      ),
    includeCover: z
      .boolean()
      .optional()
      .describe(
        'Whether to include cover images in archive day items. Defaults to false (0).',
      ),
  }),
  output: z.object({
    items: z
      .array(ArchiveItemSchema)
      .describe('Archived story items sorted most recent first'),
    totalCount: z
      .number()
      .describe('Number of archived story items returned in this page'),
    hasMore: z
      .boolean()
      .describe('Whether more archived stories exist beyond this page'),
    maxId: z
      .string()
      .nullable()
      .describe(
        'Cursor for fetching older archived stories, null if no more pages',
      ),
    reelAutoArchive: z
      .string()
      .describe(
        'Auto-archive setting: "on" if story archive is enabled, "unset" if disabled',
      ),
  }),
};

export type GetStoryArchiveInput = z.infer<typeof getStoryArchiveSchema.input>;
export type GetStoryArchiveOutput = z.infer<
  typeof getStoryArchiveSchema.output
>;

// ============================================================================
// All Schemas (for this split file)
// ============================================================================

export const storiesSchemas = [
  getStoriesTraySchema,
  getHighlightsSchema,
  getStoryArchiveSchema,
];
