import { z } from 'zod';

export const libraryDescription =
  'X (Twitter) operations via internal GraphQL API';

export const libraryIcon = '/icons/libs/x.png';
export const loginUrl = 'https://x.com';

export const libraryNotes = `
## Getting started

Navigate to \`https://x.com\`, then call \`getContext()\` first — it returns the
authenticated \`{ csrf, userId }\`. CSRF is handled internally by every function;
you never pass it. A \`userId\` argument is optional on the authenticated user's
own profile/timeline reads (it defaults to the logged-in account) and required
only when targeting another account.

## Research & discovery — COMPOSE, never hardcode

When asked to find trending topics, top/influential people, niche voices, or
their content, you MUST discover it live by chaining the functions below. Do NOT
answer from memory or a fixed list of famous accounts — "the usual suspects" are
not the same as who is getting traction right now, and guessing handles is wrong.
Always say which query/trend/list you discovered each result from.

- **Top voices on a topic** (e.g. "top people in tech/entrepreneurship"):
  \`searchPosts("<topic terms> min_faves:500 lang:en -filter:replies", product:"Top", count:40)\`,
  then collect each post's \`author\`, dedupe, and rank by engagement
  (likeCount+repostCount) and/or \`author\` follower count. This surfaces who is
  actually active NOW. \`searchUsers\` finds accounts by name/bio keyword but does
  not rank by current traction — use it to look someone up, not to rank a field.
- **What's trending**: \`getTrends\` (your locale) or \`getTrendsByLocation\`
  (a specific country/city). Then \`searchPosts(trend.name)\` to see the conversation
  and \`getProfile\`/aggregate authors to find who's driving it.
- **Niche communities / curated audiences**: \`searchUsers("<niche>")\`, or find a
  relevant List (\`listUserLists\` on a hub account → \`getListMembers\`).
- **Someone's content & influence**: \`getProfile\` (+followers), \`getUserPosts\`
  (rank by engagement for their best), \`getUserArticles\` → \`getArticle\` for essays.
- **Articles (essays)** are per-account only: \`getUserArticles(screenName)\`. There
  is no global article-by-topic search — to find tech articles, list articles from
  tech accounts you discovered via the recipes above.

## Direct messages

DM conversations are cursor-paginated. Read a conversation before its messages.
Reactions are one-per-user-per-message (adding a new one replaces the old). To
start a new 1:1 thread, construct the conversation id as
\`"{smallerUserId}-{largerUserId}"\` with the two numeric ids sorted ascending. If
a password/passcode prompt blocks the inbox, clear it before reading messages.

## Multi-account

Several accounts can be signed in at once; one is active at a time. Switching the
active account rotates the CSRF token, so re-fetch context after a switch before
making more calls.

## Pagination

Cursor-based: list responses carry a forward cursor; pass it back to fetch the
next page.

## Rate limiting

Mutations can be silently dropped when rate-limited or spam-flagged: the API
returns 200 with empty result data and no error. Space mutations 2–3s apart, and
treat an empty result as a silent drop — do not retry immediately.
`;

export const crmTrackable: Record<string, { argFields?: readonly string[]; resultFields?: readonly string[] }> = {
  sendDM: {
    argFields: ['conversationId', 'text'],
    resultFields: ['eventId', 'conversationId', 'text'],
  },
};

export const borgableFunctions: Record<string, { access: 'read' | 'write'; nonPassableArgs: readonly string[] }> = {
  getDMConversation: { access: 'read', nonPassableArgs: [] },
};

// ============================================================================
// Rate Limits
// ============================================================================

export const rateLimits: Record<
  string,
  Array<{ window: 'MINUTE' | 'HOUR' | 'DAY'; maxCalls: number; message: string }>
> = {
  // Caps below are for FREE / unverified accounts and sit deliberately under
  // X's documented ceilings (Premium/verified accounts get much higher
  // posting allowances). Sourced from help.x.com "Understanding X limits" +
  // 2025/26 references:
  //   posts  : X CUT free accounts to 50 ORIGINAL posts/day + 200 replies/day
  //            in 2026 (down from the old ~2,400/day general cap). 50/day is the
  //            binding constraint for createPost, which covers both standalone
  //            posts and replies — we can't tell them apart per-call, so we cap
  //            at the tighter original-post number.
  //   follows: 400/day (Premium 1,000)
  //   DMs    : 500/day (spam-flagging triggers well before the cap)
  //   likes  : no published cap; "hundreds/hour" via automation → temp restriction
  // The MINUTE caps are the human-pacing layer that actually prevents flags.
  // Posting — X shadowbans high-frequency web posting; the MINUTE cap keeps
  // bursts human-paced (the layer that actually prevents flags).
  createPost: [
    { window: 'MINUTE', maxCalls: 5, message: 'Pace posts to look human; bursts trigger X automation flags' },
    { window: 'HOUR', maxCalls: 25, message: 'Half the free daily budget per hour; avoids burning the 50/day cap in one burst' },
    { window: 'DAY', maxCalls: 50, message: 'X cut free accounts to 50 original posts/day in 2026; staying at it' },
  ],
  createPollPost: [
    { window: 'MINUTE', maxCalls: 5, message: 'Poll posts count as tweets; pace to look human' },
    { window: 'HOUR', maxCalls: 25, message: 'Shares the tweet hourly ceiling' },
    { window: 'DAY', maxCalls: 50, message: 'Shares the free-account 50-posts/day cap' },
  ],
  createScheduledPost: [
    { window: 'MINUTE', maxCalls: 5, message: 'Pace scheduling to look human' },
    { window: 'DAY', maxCalls: 50, message: 'Counts against the free-account 50-posts/day activity cap' },
  ],
  // Reposts are a separate, less-documented budget from original posts; X does
  // not publish a clean number. Capped conservatively below the old 300 lineage.
  createRepost: [
    { window: 'MINUTE', maxCalls: 5, message: 'Repost bursts look bot-like; pace them' },
    { window: 'HOUR', maxCalls: 30, message: 'Repost hourly ceiling (estimated; X publishes no figure)' },
    { window: 'DAY', maxCalls: 100, message: 'Conservative repost daily ceiling (estimated; X publishes no figure)' },
  ],
  // Likes are X's most common automation signal; bursts get temp-blocked fast.
  likePost: [
    { window: 'MINUTE', maxCalls: 15, message: 'Like bursts are a top X automation signal; keep them paced' },
    { window: 'HOUR', maxCalls: 250, message: 'X temp-restricts "hundreds of likes/hour" via automation; stay under' },
    { window: 'DAY', maxCalls: 800, message: 'Under the commonly-cited ~1000/day like threshold' },
  ],
  // Follow/unfollow bursts are the #1 X account-flag trigger.
  followUser: [
    { window: 'MINUTE', maxCalls: 5, message: 'Follow bursts are the top X ban trigger; keep human-paced' },
    { window: 'HOUR', maxCalls: 30, message: 'Follow-rate guards trigger fast' },
    { window: 'DAY', maxCalls: 400, message: 'Daily follow ceiling per X policy' },
  ],
  unfollowUser: [
    { window: 'MINUTE', maxCalls: 5, message: 'Mass-unfollow reads as aggressive automation' },
    { window: 'DAY', maxCalls: 400, message: 'Daily unfollow ceiling' },
  ],
  // DMs — the daily cap was here; add minute/hour pacing so bursts don't read as spam.
  sendDM: [
    { window: 'MINUTE', maxCalls: 5, message: 'Pace DMs to look human; bursts read as spam' },
    { window: 'HOUR', maxCalls: 60, message: 'DM hourly ceiling before a spam flag' },
    { window: 'DAY', maxCalls: 250, message: 'Conservative; X official DM cap is 500/day but spam-flagging hits earlier' },
  ],
  sendDMImage: [
    { window: 'MINUTE', maxCalls: 5, message: 'Shares the DM send budget; pace to avoid spam flags' },
    { window: 'DAY', maxCalls: 250, message: 'Shares the daily DM cap' },
  ],
  // Search abuse also flags; cap the rate like LinkedIn's searchPeople.
  searchPosts: [
    { window: 'MINUTE', maxCalls: 30, message: 'Search rate ceiling to avoid abuse flags' },
  ],
};

// ============================================================================
// Context
// ============================================================================

export const getContextSchema = {
  name: 'getContext',
  description: 'Get CSRF token and user ID for X API calls',
  notes: 'Call FIRST before other X operations.',
  input: z.object({}),
  output: z.object({
    csrf: z.string().describe('CSRF token (ct0 cookie value)'),
    userId: z.string().describe('Authenticated user numeric ID'),
  }),
};

// ============================================================================
// Posts
// ============================================================================

export const TweetSchema = z.object({
  id: z.string().describe('Tweet ID'),
  url: z
    .string()
    .describe('Direct link to this post on x.com (clickable permalink)'),
  text: z.string().describe('Full text content of the tweet'),
  createdAt: z
    .string()
    .describe(
      'Creation timestamp, ISO 8601 UTC, millisecond-precise (derived from the tweet ID, e.g. "2025-11-04T11:55:12.988Z"). Convert to the user\'s local timezone when displaying.',
    ),
  lang: z.string().optional().describe('Language code (e.g. "en")'),
  isRepost: z.boolean().describe('Whether this is a repost'),
  isQuotePost: z.boolean().describe('Whether this quotes another post'),
  viewCount: z.number().optional().describe('Number of views'),
  repostCount: z.number().describe('Number of reposts'),
  likeCount: z.number().describe('Number of likes'),
  replyCount: z.number().describe('Number of replies'),
  quoteCount: z.number().describe('Number of quote posts'),
  bookmarkCount: z.number().describe('Number of bookmarks'),
  liked: z.boolean().describe('Whether the authenticated user liked this post'),
  reposted: z
    .boolean()
    .describe('Whether the authenticated user reposted this'),
  bookmarked: z
    .boolean()
    .describe('Whether the authenticated user bookmarked this'),
  author: z
    .object({
      id: z.string().describe('Author user ID'),
      name: z.string().describe('Display name'),
      screenName: z.string().describe('Handle without @'),
      profileImageUrl: z.string().optional().describe('Profile picture URL'),
      isBlueVerified: z
        .boolean()
        .optional()
        .describe('Whether the author has a paid checkmark (true for both Premium tiers)'),
      verifiedType: z
        .string()
        .optional()
        .describe(
          'Badge kind: "None" (blue), "Business" (gold), "Government" (grey). Possibly non-exhaustive.',
        ),
    })
    .describe('Tweet author'),
  urls: z
    .array(
      z.object({
        url: z.string().describe('Shortened t.co URL'),
        expandedUrl: z.string().describe('Full destination URL'),
        displayUrl: z.string().describe('Display-friendly URL'),
      }),
    )
    .optional()
    .describe('URLs in tweet text'),
  media: z
    .array(
      z.object({
        type: z.string().describe('Media type: photo, video, animated_gif'),
        url: z
          .string()
          .describe(
            'Media URL. Photo = the image; video/animated_gif = the playable MP4 (highest quality).',
          ),
        thumbnailUrl: z
          .string()
          .optional()
          .describe('Still preview image — present for video/animated_gif'),
      }),
    )
    .optional()
    .describe('Attached media'),
  card: z
    .object({
      uri: z
        .string()
        .optional()
        .describe('Card URI (e.g. "card://123") identifying the attached card'),
      title: z.string().optional(),
      description: z.string().optional(),
      domain: z.string().optional(),
      url: z.string().optional(),
    })
    .optional()
    .describe('Link preview or poll card'),
  article: z
    .object({
      id: z.string().describe('Article entity ID (the /i/article/<id> URL id)'),
      title: z.string().describe('Article title'),
    })
    .optional()
    .describe(
      'Present when this post is a long-form Article. To read the full body, pass THIS post\'s id (the Tweet.id) to getArticle.',
    ),
});

export const listMyPostsSchema = {
  name: 'listMyPosts',
  description: "Get posts from the authenticated user's profile timeline",
  notes: '',
  input: z.object({
    userId: z
      .string()
      .optional()
      .describe(
        'User ID. Optional — defaults to the authenticated user (from getContext().userId). Only set this to read a specific account you control.',
      ),
    count: z
      .number()
      .optional()
      .default(20)
      .describe('Number of posts to fetch (default: 20)'),
    cursor: z
      .string()
      .optional()
      .describe(
        'Pagination cursor from a previous response for fetching the next page',
      ),
  }),
  output: z.object({
    posts: z.array(TweetSchema).describe('List of tweets'),
    nextCursor: z
      .string()
      .optional()
      .describe(
        'Cursor for the next page of results. Absent if no more results.',
      ),
  }),
};

export const createPostSchema = {
  name: 'createPost',
  description: "Create a new post (tweet) on the authenticated user's profile",
  notes: '',
  input: z.object({
    text: z
      .string()
      .describe(
        'The text content of the post (max 280 characters for standard accounts)',
      ),
    replyToTweetId: z
      .string()
      .optional()
      .describe('Tweet ID to reply to. Omit to create a standalone post.'),
    quoteTweetId: z
      .string()
      .optional()
      .describe(
        'Tweet ID to quote. Creates a quote post referencing this tweet. Must also provide quoteTweetAuthor.',
      ),
    quoteTweetAuthor: z
      .string()
      .optional()
      .describe(
        'Screen name (handle without @) of the quoted tweet author. Required when quoteTweetId is set.',
      ),
    replyRestriction: z
      .enum(['following', 'verified', 'mentionedOnly'])
      .optional()
      .describe(
        'Who can reply to this post. "following" = only people you follow, "verified" = only verified users, "mentionedOnly" = only mentioned users. Omit to allow everyone to reply.',
      ),
    images: z
      .array(
        z.object({
          base64: z
            .string()
            .describe('Base64-encoded image data (without data:image/... prefix)'),
          mimeType: z
            .enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
            .describe('MIME type of the image'),
        }),
      )
      .max(4)
      .optional()
      .describe('Up to 4 images to attach to the post. Omit for a text-only post.'),
  }),
  output: z.object({
    post: TweetSchema.describe('The created post'),
  }),
};

export const createPollPostSchema = {
  name: 'createPollPost',
  description: 'Create a post with an embedded poll on X',
  notes: '',
  input: z.object({
    text: z
      .string()
      .describe('The text content of the post (max 280 characters)'),
    choices: z
      .array(z.string())
      .min(2)
      .max(4)
      .describe('Poll answer choices (2 to 4 items)'),
    durationMinutes: z
      .number()
      .optional()
      .default(1440)
      .describe(
        'Poll duration in minutes. Min 1, max 10080 (7 days). Defaults to 1440 (24 hours).',
      ),
  }),
  output: z.object({
    post: TweetSchema.describe('The created post with embedded poll'),
  }),
};

export const createScheduledPostSchema = {
  name: 'createScheduledPost',
  description: 'Schedule a post to be published at a future date and time on X',
  notes: '',
  input: z.object({
    text: z
      .string()
      .describe('The text content of the post (max 280 characters)'),
    scheduledAt: z
      .string()
      .describe(
        'ISO 8601 datetime for when to publish; must be in the future. ' +
          'TIMEZONE: append "Z" for UTC (e.g. "2026-03-25T14:00:00Z" = 2pm UTC); ' +
          'OMIT the offset to schedule in the browser\'s LOCAL timezone ' +
          '(e.g. "2026-03-25T14:00:00" = 2pm local). When the user says a wall-clock ' +
          'time without naming a zone, omit the "Z" so it schedules at that local time.',
      ),
  }),
  output: z.object({
    scheduledPostId: z.string().describe('ID of the created scheduled post'),
  }),
};

export const listScheduledPostsSchema = {
  name: 'listScheduledPosts',
  description: "List all scheduled posts in the authenticated user's queue",
  notes: '',
  input: z.object({}),
  output: z.object({
    scheduledPosts: z
      .array(
        z.object({
          id: z.string().describe('Scheduled post ID'),
          text: z.string().describe('Post text content'),
          scheduledAt: z
            .string()
            .describe('ISO 8601 datetime when the post will be published'),
          state: z
            .string()
            .describe(
              'Scheduling state. Observed values: "Scheduled" (pending ' +
                'publish), "Canceled". Small but possibly non-exhaustive set.',
            ),
        }),
      )
      .describe('List of scheduled posts'),
  }),
};

export const deleteScheduledPostSchema = {
  name: 'deleteScheduledPost',
  description: 'Delete a scheduled post before it is published',
  notes: 'Get the scheduled post ID from listScheduledPosts().',
  input: z.object({
    scheduledPostId: z
      .string()
      .describe('ID of the scheduled post to delete (from listScheduledPosts)'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the deletion was successful'),
  }),
};

// ============================================================================
// Search
// ============================================================================

export const searchPostsSchema = {
  name: 'searchPosts',
  description:
    'Search for posts (tweets) on X by keyword query. Supports X\'s full search-operator syntax, which makes it powerful for research and prospecting (find specific people, high-engagement posts, date ranges, languages, locations).',
  notes:
    'The query accepts X search operators — combine them freely:\n' +
    '• People: from:handle, to:handle, @handle (mentions)\n' +
    '• Engagement filters: min_faves:100, min_retweets:50, min_replies:10\n' +
    '• Content: filter:links, filter:media, filter:images, filter:videos, filter:verified, -filter:replies (exclude replies)\n' +
    '• Time: since:2026-01-01 until:2026-06-01\n' +
    '• Language: lang:en (or ja, es, …)\n' +
    '• Location: near:"San Francisco" within:25mi, or geocode:lat,long,radius\n' +
    '• Logic: exact "phrase", OR, grouping (a OR b), exclusion -term\n' +
    'Example prospecting query: \'"AI agents" min_faves:50 filter:verified lang:en since:2026-05-01\'. Use product:"Latest" for recency, "Top" for relevance.',
  input: z.object({
    query: z
      .string()
      .describe(
        'Search query — plain keywords and/or X operators, e.g. "agent orchestration", "from:elonmusk filter:media", \'"series A" min_faves:100 filter:verified\'',
      ),
    product: z
      .enum(['Top', 'Latest'])
      .optional()
      .default('Top')
      .describe(
        'Sort order. "Top" = relevance (default), "Latest" = most recent.',
      ),
    count: z
      .number()
      .optional()
      .default(20)
      .describe('Number of posts to fetch (default: 20)'),
    cursor: z
      .string()
      .optional()
      .describe(
        'Pagination cursor from a previous response for fetching the next page',
      ),
  }),
  output: z.object({
    posts: z.array(TweetSchema).describe('List of matching tweets'),
    nextCursor: z
      .string()
      .optional()
      .describe(
        'Cursor for the next page of results. Absent if no more results.',
      ),
  }),
};

// ============================================================================
// Like / Repost
// ============================================================================

export const likePostSchema = {
  name: 'likePost',
  description: 'Like (favorite) a post on X',
  notes: '',
  input: z.object({
    tweetId: z.string().describe('ID of the tweet to like'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the like was successful'),
  }),
};

export const createRepostSchema = {
  name: 'createRepost',
  description: 'Repost (retweet) a post on X',
  notes: '',
  input: z.object({
    tweetId: z.string().describe('ID of the tweet to repost'),
  }),
  output: z.object({
    retweetId: z.string().describe('ID of the created retweet'),
  }),
};

// ============================================================================
// Profile
// ============================================================================

export const UserProfileSchema = z.object({
  id: z.string().describe('User numeric ID'),
  name: z.string().describe('Display name'),
  screenName: z.string().describe('Handle without @'),
  profileUrl: z
    .string()
    .describe('Direct link to this profile on x.com (clickable permalink)'),
  description: z.string().describe('Bio text'),
  location: z.string().optional().describe('Profile location'),
  url: z
    .string()
    .optional()
    .describe("The user's own website link from their bio (expanded), NOT their X profile — see profileUrl for that"),
  profileImageUrl: z.string().optional().describe('Profile picture URL'),
  profileBannerUrl: z.string().optional().describe('Profile banner image URL'),
  isBlueVerified: z
    .boolean()
    .describe(
      'Whether the user has a paid checkmark. NOTE: a single boolean true for ' +
        'BOTH Premium and Premium+ — it cannot distinguish the consumer tier, ' +
        'and free $3 "Basic" accounts have no checkmark (so this is false for them).',
    ),
  verifiedType: z
    .string()
    .optional()
    .describe(
      'Kind of verification badge, which sets the badge COLOUR. Observed ' +
        'values: "None" (blue individual / unverified), "Business" (gold, a ' +
        'Verified Organization), "Government" (grey). Combine with ' +
        'isBlueVerified to classify the badge. Does NOT reveal Premium vs ' +
        'Premium+. Possibly non-exhaustive.',
    ),
  isIdentityVerified: z
    .boolean()
    .optional()
    .describe('Whether the account is government-ID verified (shown on badge click)'),
  affiliateLabel: z
    .object({
      description: z
        .string()
        .optional()
        .describe('Parent organization name shown next to the badge'),
      badgeUrl: z
        .string()
        .optional()
        .describe("Parent organization's badge image URL"),
    })
    .optional()
    .describe(
      "Affiliation to a Verified Organization (employee / sub-account); absent for unaffiliated accounts",
    ),
  isProtected: z.boolean().describe('Whether the account is private'),
  followersCount: z.number().describe('Number of followers'),
  followingCount: z.number().describe('Number of accounts followed'),
  statusesCount: z.number().describe('Total number of tweets'),
  likesCount: z.number().describe('Total number of likes'),
  listedCount: z.number().describe('Number of lists the user is on'),
  mediaCount: z.number().describe('Number of media posts'),
  createdAt: z.string().describe('Account creation timestamp, ISO 8601'),
  pinnedTweetIds: z.array(z.string()).describe('IDs of pinned tweets'),
  isFollowing: z
    .boolean()
    .describe('Whether the authenticated user follows this account'),
});

export const getProfileSchema = {
  name: 'getProfile',
  description:
    'Get detailed profile information for an X user by their screen name (handle)',
  notes:
    'Use to QUALIFY a person, not just fetch a name: returns followersCount/followingCount (reach), verifiedType + affiliateLabel (who they are / org), bio, location, website, and pinnedTweetIds. Great for vetting a lead surfaced by search/likers/list members.',
  input: z.object({
    screenName: z.string().describe('X handle without @ (e.g. "elonmusk")'),
  }),
  output: z.object({
    profile: UserProfileSchema.describe('User profile data'),
  }),
};

// ============================================================================
// Follow / Unfollow
// ============================================================================

export const followUserSchema = {
  name: 'followUser',
  description: 'Follow an X user by their user ID',
  notes: 'Get the user ID from getProfile() first.',
  input: z.object({
    userId: z
      .string()
      .describe(
        'Numeric user ID of the account to follow (from getProfile().profile.id)',
      ),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the follow was successful'),
    user: z
      .object({
        id: z.string().describe('User numeric ID'),
        name: z.string().describe('Display name'),
        screenName: z.string().describe('Handle without @'),
      })
      .describe('The followed user'),
  }),
};

export const unfollowUserSchema = {
  name: 'unfollowUser',
  description: 'Unfollow an X user by their user ID',
  notes: 'Get the user ID from getProfile() first.',
  input: z.object({
    userId: z
      .string()
      .describe(
        'Numeric user ID of the account to unfollow (from getProfile().profile.id)',
      ),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the unfollow was successful'),
  }),
};

// ============================================================================
// Unlike / Delete Post / Delete Repost
// ============================================================================

export const unlikePostSchema = {
  name: 'unlikePost',
  description: 'Unlike (unfavorite) a previously liked post on X',
  notes: '',
  input: z.object({
    tweetId: z.string().describe('ID of the tweet to unlike'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the unlike was successful'),
  }),
};

export const deletePostSchema = {
  name: 'deletePost',
  description: 'Delete a tweet you authored by its ID',
  notes: '',
  input: z.object({
    tweetId: z.string().describe('ID of the tweet to delete'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the deletion was successful'),
  }),
};

export const deleteRepostSchema = {
  name: 'deleteRepost',
  description: 'Undo a repost (unretweet) on X',
  notes: '',
  input: z.object({
    tweetId: z.string().describe('ID of the original tweet that was reposted'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the unretweet was successful'),
  }),
};

// ============================================================================
// Bookmarks
// ============================================================================

export const bookmarkPostSchema = {
  name: 'bookmarkPost',
  description: "Add a post to the authenticated user's bookmarks",
  notes: '',
  input: z.object({
    tweetId: z.string().describe('ID of the tweet to bookmark'),
  }),
  output: z.object({
    success: z
      .boolean()
      .describe('Whether the bookmark was created successfully'),
  }),
};

export const unbookmarkPostSchema = {
  name: 'unbookmarkPost',
  description: "Remove a post from the authenticated user's bookmarks",
  notes: '',
  input: z.object({
    tweetId: z.string().describe('ID of the tweet to remove from bookmarks'),
  }),
  output: z.object({
    success: z
      .boolean()
      .describe('Whether the bookmark was removed successfully'),
  }),
};

export const listBookmarksSchema = {
  name: 'listBookmarks',
  description: "List posts saved in the authenticated user's bookmarks",
  notes: '',
  input: z.object({
    count: z
      .number()
      .optional()
      .default(20)
      .describe('Number of bookmarks to fetch (default: 20)'),
    cursor: z
      .string()
      .optional()
      .describe(
        'Pagination cursor from a previous response for fetching the next page',
      ),
  }),
  output: z.object({
    posts: z.array(TweetSchema).describe('List of bookmarked tweets'),
    nextCursor: z
      .string()
      .optional()
      .describe(
        'Cursor for the next page of results. Absent if no more results.',
      ),
  }),
};

// ============================================================================
// Timelines
// ============================================================================

export const getForYouTimelineSchema = {
  name: 'getForYouTimeline',
  description: 'Get the algorithmic "For You" home feed',
  notes:
    'Posts carry engagement counts — rank by them to pull the most-resonant content from the feed.',
  input: z.object({
    count: z
      .number()
      .optional()
      .default(20)
      .describe('Number of posts to fetch (default: 20)'),
    cursor: z
      .string()
      .optional()
      .describe('Pagination cursor from a previous response'),
  }),
  output: z.object({
    posts: z.array(TweetSchema).describe('List of tweets from For You feed'),
    nextCursor: z
      .string()
      .optional()
      .describe('Cursor for the next page. Absent if no more results.'),
  }),
};

export const getFollowingTimelineSchema = {
  name: 'getFollowingTimeline',
  description: 'Get the chronological "Following" home feed',
  notes:
    'Chronological (newest first) posts from accounts you follow; rank by engagement counts for the most-resonant.',
  input: z.object({
    count: z
      .number()
      .optional()
      .default(20)
      .describe('Number of posts to fetch (default: 20)'),
    cursor: z
      .string()
      .optional()
      .describe('Pagination cursor from a previous response'),
  }),
  output: z.object({
    posts: z
      .array(TweetSchema)
      .describe('List of tweets from Following feed (chronological)'),
    nextCursor: z
      .string()
      .optional()
      .describe('Cursor for the next page. Absent if no more results.'),
  }),
};

export const getUserPostsSchema = {
  name: 'getUserPosts',
  description: "Get posts from a user's profile timeline (by user ID)",
  notes:
    'Posts carry engagement counts (likeCount/repostCount/replyCount) — rank by them to surface a user\'s best / most-resonant content, or scan for which topics they get traction on. Get the userId from getProfile().profile.id.',
  input: z.object({
    userId: z
      .string()
      .describe(
        'Numeric user ID of the target user (from getProfile().profile.id)',
      ),
    count: z
      .number()
      .optional()
      .default(20)
      .describe('Number of posts to fetch (default: 20)'),
    cursor: z
      .string()
      .optional()
      .describe('Pagination cursor from a previous response'),
  }),
  output: z.object({
    posts: z.array(TweetSchema).describe("List of the user's tweets"),
    nextCursor: z
      .string()
      .optional()
      .describe('Cursor for the next page. Absent if no more results.'),
  }),
};

export const getUserRepliesSchema = {
  name: 'getUserReplies',
  description: "Get posts and replies from any user's replies tab",
  notes: 'Get the userId from getProfile().profile.id.',
  input: z.object({
    userId: z
      .string()
      .describe(
        'Numeric user ID of the target user (from getProfile().profile.id)',
      ),
    count: z
      .number()
      .optional()
      .default(20)
      .describe('Number of posts to fetch (default: 20)'),
    cursor: z
      .string()
      .optional()
      .describe('Pagination cursor from a previous response'),
  }),
  output: z.object({
    posts: z
      .array(TweetSchema)
      .describe("List of the user's tweets and replies"),
    nextCursor: z
      .string()
      .optional()
      .describe('Cursor for the next page. Absent if no more results.'),
  }),
};

// ============================================================================
// User Content & Profile
// ============================================================================

export const NotificationSchema = z.object({
  id: z.string().describe('Notification ID'),
  timestamp: z
    .string()
    .describe('Notification timestamp, ISO 8601'),
  iconType: z
    .string()
    .describe(
      'X notification icon id indicating the kind of notification. ' +
        'Non-exhaustive set (X may add ids); observed values: "heart" (like), ' +
        '"retweet", "person_follow" (new follower), "mention".',
    ),
  message: z.string().describe('Human-readable notification message text'),
  entities: z
    .array(
      z.object({
        fromIndex: z.number().describe('Start character index in message text'),
        toIndex: z.number().describe('End character index in message text'),
      }),
    )
    .optional()
    .describe('Text entity spans (e.g. user mentions) in the message'),
});

export const getUserLikesSchema = {
  name: 'getUserLikes',
  description:
    'List tweets liked by the authenticated user from their Likes tab',
  notes:
    "Only works for the authenticated user. X does not expose other users' likes publicly.",
  input: z.object({
    userId: z
      .string()
      .optional()
      .describe(
        'Numeric user ID. Optional — defaults to the authenticated user (from getContext().userId). Likes are only exposed for the authenticated user.',
      ),
    count: z
      .number()
      .optional()
      .default(20)
      .describe('Number of liked tweets to fetch (default: 20)'),
    cursor: z
      .string()
      .optional()
      .describe('Pagination cursor from a previous response'),
  }),
  output: z.object({
    posts: z.array(TweetSchema).describe('List of liked tweets'),
    nextCursor: z
      .string()
      .optional()
      .describe(
        'Cursor for the next page of results. Absent if no more results.',
      ),
  }),
};

export const listNotificationsSchema = {
  name: 'listNotifications',
  description:
    "Get notifications from the authenticated user's notification feed (likes, reposts, follows, mentions)",
  notes: '',
  input: z.object({
    count: z
      .number()
      .optional()
      .default(20)
      .describe('Number of notifications to fetch (default: 20)'),
    timelineType: z
      .enum(['All', 'Mentions'])
      .optional()
      .default('All')
      .describe(
        '"All" for the main notifications tab, "Mentions" for mentions-only tab',
      ),
    cursor: z
      .string()
      .optional()
      .describe('Pagination cursor from a previous response'),
  }),
  output: z.object({
    notifications: z
      .array(NotificationSchema)
      .describe('List of notification items'),
    nextCursor: z
      .string()
      .optional()
      .describe(
        'Cursor for the next page of results. Absent if no more results.',
      ),
  }),
};

export const updateProfileSchema = {
  name: 'updateProfile',
  description:
    "Update the authenticated user's profile fields (display name, bio, location, website)",
  notes: 'All fields are optional; only provided fields are updated.',
  input: z.object({
    name: z.string().optional().describe('Display name (max 50 characters)'),
    description: z
      .string()
      .optional()
      .describe('Bio text (max 160 characters)'),
    location: z
      .string()
      .optional()
      .describe('Profile location string (max 30 characters)'),
    url: z.string().optional().describe('Website URL to show on profile'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the update succeeded'),
    profile: z
      .object({
        id: z.string().describe('User numeric ID'),
        name: z.string().describe('Updated display name'),
        screenName: z.string().describe('Handle without @'),
        description: z.string().describe('Updated bio text'),
        location: z.string().optional().describe('Updated location'),
        url: z.string().optional().describe('Updated website URL (expanded)'),
      })
      .describe('Updated profile fields returned by the API'),
  }),
};

// ============================================================================
// Messaging
// ============================================================================

export const DMConversationSchema = z.object({
  id: z.string().describe('Conversation ID'),
  type: z
    .enum(['ONE_TO_ONE', 'GROUP_DM'])
    .describe('Conversation type'),
  lastMessage: z
    .object({
      text: z.string().describe('Message text'),
      sender: z.string().describe('Sender user ID'),
      timestamp: z.string().describe('Message timestamp, ISO 8601'),
    })
    .optional()
    .describe('Most recent message in the conversation'),
  participants: z
    .array(z.string())
    .describe('User IDs of conversation participants'),
});

export const sendDMSchema = {
  name: 'sendDM',
  description: 'Send a direct message to an existing DM conversation',
  notes:
    'conversationId for a new 1:1 conversation is "{yourUserId}-{theirUserId}" with IDs sorted numerically ascending. Get yourUserId from getContext().userId. **CRM**: After sending, this DM and its conversation are logged to the CRM automatically — you do not need to record them. The DM counterpart is captured as a contact automatically.',
  input: z.object({
    conversationId: z
      .string()
      .describe(
        'Conversation ID. For a new 1:1 conversation, use "{smallerUserId}-{largerUserId}" (sorted numerically). For existing conversations, use the id from listDMInbox.',
      ),
    text: z.string().describe('Message text to send'),
  }),
  output: z.object({
    eventId: z.string().describe('ID of the created message event'),
    conversationId: z
      .string()
      .describe('Conversation ID the message was sent to'),
    text: z.string().describe('Message text that was sent'),
  }),
};

export const listDMInboxSchema = {
  name: 'listDMInbox',
  description:
    "List DM conversations from the authenticated user's inbox, including the most recent message in each conversation",
  notes: '',
  input: z.object({
    cursor: z
      .string()
      .optional()
      .describe('Pagination cursor from a previous response'),
  }),
  output: z.object({
    conversations: z
      .array(DMConversationSchema)
      .describe('DM conversations, most recent first'),
    nextCursor: z
      .string()
      .optional()
      .describe('Pagination cursor for the next page of conversations'),
  }),
};

export const getDMConversationSchema = {
  name: 'getDMConversation',
  description:
    'Get messages in a DM conversation by conversation ID, with participant info',
  notes:
    'Get conversationId from listDMInbox(). Messages are returned newest-first. Use nextCursor for pagination.',
  input: z.object({
    conversationId: z
      .string()
      .describe(
        'Conversation ID from listDMInbox() or constructed as "{smallerUserId}-{largerUserId}"',
      ),
    count: z
      .number()
      .optional()
      .default(50)
      .describe('Number of messages to fetch (default: 50)'),
    cursor: z
      .string()
      .optional()
      .describe(
        'Pagination cursor (min_entry_id from previous response) for older messages',
      ),
  }),
  output: z.object({
    messages: z
      .array(
        z.object({
          id: z.string().describe('Message ID'),
          text: z.string().describe('Message text content'),
          senderId: z.string().describe('Sender user ID'),
          recipientId: z.string().describe('Recipient user ID'),
          timestamp: z
            .string()
            .describe('Message timestamp, ISO 8601'),
        }),
      )
      .describe('Messages in the conversation, newest first'),
    participants: z
      .array(
        z.object({
          id: z.string().describe('User ID'),
          name: z.string().describe('Display name'),
          screenName: z.string().describe('Handle without @'),
          profileImageUrl: z
            .string()
            .optional()
            .describe('Profile picture URL'),
        }),
      )
      .describe('Conversation participants'),
    nextCursor: z
      .string()
      .optional()
      .describe(
        'Cursor for fetching older messages. Absent if no more messages.',
      ),
  }),
};

export const deleteDMConversationSchema = {
  name: 'deleteDMConversation',
  description:
    'Delete a DM conversation and all its messages for the authenticated user',
  notes:
    'This only deletes the conversation from your side. The other participant can still see their copy.',
  input: z.object({
    conversationId: z
      .string()
      .describe('Conversation ID to delete (from listDMInbox)'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the deletion was successful'),
  }),
};

export const reactToDMSchema = {
  name: 'reactToDM',
  description: 'Add an emoji reaction to a DM message',
  notes:
    'Get messageId from getDMConversation(). Only one reaction per user per message; adding a new one replaces the old.',
  input: z.object({
    conversationId: z
      .string()
      .describe('Conversation ID containing the message'),
    messageId: z
      .string()
      .describe('Message ID to react to (from getDMConversation)'),
    reaction: z
      .enum(['agree', 'disagree', 'funny', 'sad', 'surprised', 'like'])
      .describe(
        'Reaction type. agree=👍, disagree=👎, funny=😂, sad=😢, surprised=😮, like=❤️',
      ),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the reaction was added'),
  }),
};

export const removeReactionSchema = {
  name: 'removeReaction',
  description: 'Remove your emoji reaction from a DM message',
  notes: 'Get messageId from getDMConversation().',
  input: z.object({
    conversationId: z
      .string()
      .describe('Conversation ID containing the message'),
    messageId: z.string().describe('Message ID to remove reaction from'),
    reaction: z
      .enum(['agree', 'disagree', 'funny', 'sad', 'surprised', 'like'])
      .describe('Reaction type to remove'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the reaction was removed'),
  }),
};

export const sendDMImageSchema = {
  name: 'sendDMImage',
  description:
    'Upload and send an image as a direct message in a DM conversation',
  notes:
    'Accepts base64-encoded image data. Supports PNG, JPEG, GIF, and WebP. Max 5MB after decoding. Can include optional text alongside the image.',
  input: z.object({
    conversationId: z.string().describe('Conversation ID to send the image to'),
    imageBase64: z
      .string()
      .describe('Base64-encoded image data (without data:image/... prefix)'),
    mimeType: z
      .enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
      .describe('MIME type of the image'),
    text: z
      .string()
      .optional()
      .default('')
      .describe('Optional text message to send with the image'),
  }),
  output: z.object({
    eventId: z.string().describe('ID of the created message event'),
    conversationId: z.string().describe('Conversation ID'),
    mediaId: z.string().describe('Uploaded media ID'),
  }),
};

export const deleteDMSchema = {
  name: 'deleteDM',
  description:
    'Delete a single DM message from a conversation (deletes from your side only)',
  notes:
    'Get messageId from getDMConversation(). The other participant can still see the message.',
  input: z.object({
    messageId: z
      .string()
      .describe('Message ID to delete (from getDMConversation)'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the message was deleted'),
  }),
};

// ============================================================================
// Multi-Account
// ============================================================================

export const listAccountsSchema = {
  name: 'listAccounts',
  description:
    'List all X accounts logged in to this browser session, with which one is currently active',
  notes: '',
  input: z.object({}),
  output: z.object({
    accounts: z
      .array(
        z.object({
          userId: z.string().describe('User numeric ID'),
          name: z.string().describe('Display name'),
          screenName: z.string().describe('Handle without @'),
          avatarUrl: z.string().optional().describe('Profile picture URL'),
          isActive: z
            .boolean()
            .describe('Whether this is the currently active account'),
          isAuthValid: z
            .boolean()
            .describe('Whether the auth session is still valid'),
        }),
      )
      .describe('All logged-in X accounts'),
  }),
};

export const switchAccountSchema = {
  name: 'switchAccount',
  description:
    'Switch to a different logged-in X account. After switching, the CSRF token changes; call getContext() again before making further API calls.',
  notes:
    'Get available accounts from listAccounts(). After switching, you MUST call getContext() to refresh auth tokens. All subsequent API calls will use the new account.',
  input: z.object({
    userId: z
      .string()
      .describe(
        'User ID of the account to switch to (from listAccounts().accounts[].userId)',
      ),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the switch was successful'),
    userId: z.string().describe('The user ID now active after switching'),
  }),
};

// ============================================================================
// DM Password Entry
// ============================================================================

// ============================================================================
// Post Detail / Thread / Edit
// ============================================================================

export const getPostSchema = {
  name: 'getPost',
  description:
    'Get a single post (tweet) by its ID, together with its reply thread',
  notes: 'Use the tweet ID from a list/search/timeline result.',
  input: z.object({
    tweetId: z.string().describe('ID of the tweet to fetch'),
    count: z
      .number()
      .optional()
      .default(20)
      .describe('Number of replies to fetch (default: 20)'),
    cursor: z
      .string()
      .optional()
      .describe('Pagination cursor from a previous response for more replies'),
  }),
  output: z.object({
    post: TweetSchema.describe('The focal post'),
    replies: z.array(TweetSchema).describe('Replies in the conversation thread'),
    nextCursor: z
      .string()
      .optional()
      .describe('Cursor for more replies. Absent if no more.'),
  }),
};

export const createThreadSchema = {
  name: 'createThread',
  description:
    'Create a thread (multiple connected posts) — each post replies to the previous one',
  notes:
    'Posts are published in order; each is a reply to the one before it. Counts as multiple posts against the daily posting cap.',
  input: z.object({
    texts: z
      .array(z.string())
      .min(2)
      .describe('Post texts in order; 2 or more. The first is the root post.'),
    replyRestriction: z
      .enum(['following', 'verified', 'mentionedOnly'])
      .optional()
      .describe('Who can reply to the root post (applied to the first post only)'),
  }),
  output: z.object({
    posts: z
      .array(TweetSchema)
      .describe('The created posts, in thread order (root first)'),
  }),
};

export const editPostSchema = {
  name: 'editPost',
  description:
    'Edit an existing post you authored. PREMIUM-ONLY and time-limited (X allows edits for ~60 minutes, up to 5 edits).',
  notes:
    'Requires a paid X subscription; free accounts cannot edit. Editing creates a new tweet ID that supersedes the old one. Fails if outside the edit window.',
  input: z.object({
    tweetId: z.string().describe('ID of the tweet to edit'),
    text: z.string().describe('New full text for the post (max 280 / 25k chars)'),
  }),
  output: z.object({
    post: TweetSchema.describe('The edited post (note: it has a NEW id)'),
  }),
};

export const pinTweetSchema = {
  name: 'pinTweet',
  description: "Pin one of your posts to the top of your profile",
  notes: 'Only one post can be pinned at a time; pinning replaces the existing pin.',
  input: z.object({
    tweetId: z.string().describe('ID of your tweet to pin'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the pin succeeded'),
  }),
};

export const unpinTweetSchema = {
  name: 'unpinTweet',
  description: 'Unpin the currently pinned post from your profile',
  notes: '',
  input: z.object({
    tweetId: z.string().describe('ID of the pinned tweet to unpin'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the unpin succeeded'),
  }),
};

// ============================================================================
// Social Graph (followers / following / who-liked / who-reposted)
// ============================================================================

export const listFollowersSchema = {
  name: 'listFollowers',
  description: 'List the accounts that follow a user',
  notes: 'Get the userId from getProfile().profile.id. Defaults to the authenticated user.',
  input: z.object({
    userId: z
      .string()
      .optional()
      .describe(
        'Numeric user ID (from getProfile().profile.id). Optional — defaults to the authenticated user.',
      ),
    count: z
      .number()
      .optional()
      .default(20)
      .describe('Number of followers to fetch (default: 20)'),
    cursor: z
      .string()
      .optional()
      .describe('Pagination cursor from a previous response'),
  }),
  output: z.object({
    users: z.array(UserProfileSchema).describe('Follower profiles'),
    nextCursor: z
      .string()
      .optional()
      .describe('Cursor for the next page. Absent if no more.'),
  }),
};

export const listFollowingSchema = {
  name: 'listFollowing',
  description: 'List the accounts a user is following',
  notes: 'Get the userId from getProfile().profile.id. Defaults to the authenticated user.',
  input: z.object({
    userId: z
      .string()
      .optional()
      .describe(
        'Numeric user ID (from getProfile().profile.id). Optional — defaults to the authenticated user.',
      ),
    count: z
      .number()
      .optional()
      .default(20)
      .describe('Number of accounts to fetch (default: 20)'),
    cursor: z
      .string()
      .optional()
      .describe('Pagination cursor from a previous response'),
  }),
  output: z.object({
    users: z.array(UserProfileSchema).describe('Followed account profiles'),
    nextCursor: z
      .string()
      .optional()
      .describe('Cursor for the next page. Absent if no more.'),
  }),
};

export const searchUsersSchema = {
  name: 'searchUsers',
  description: 'Search for X users (people) by name/handle/bio keyword',
  notes:
    'Returns full profiles — rank the results by followersCount to surface the biggest accounts in a niche. Matches profile text, NOT current traction: to find who is actively driving a topic right now, prefer searchPosts("<topic> min_faves:500", Top) and aggregate/rank the post authors. Use searchPosts to find tweets.',
  input: z.object({
    query: z.string().describe('Search query (name, handle, or keywords)'),
    count: z
      .number()
      .optional()
      .default(20)
      .describe('Number of users to fetch (default: 20)'),
    cursor: z
      .string()
      .optional()
      .describe('Pagination cursor from a previous response'),
  }),
  output: z.object({
    users: z.array(UserProfileSchema).describe('Matching user profiles'),
    nextCursor: z
      .string()
      .optional()
      .describe('Cursor for the next page. Absent if no more.'),
  }),
};

export const getLikersSchema = {
  name: 'getLikers',
  description: 'List the users who liked a post',
  notes:
    'Prospecting: people who liked a topic-relevant post are a warm, topic-qualified audience — pull them and rank/qualify by followersCount or getProfile. Use the tweet ID from a list/search/timeline result.',
  input: z.object({
    tweetId: z.string().describe('ID of the tweet'),
    count: z
      .number()
      .optional()
      .default(20)
      .describe('Number of users to fetch (default: 20)'),
    cursor: z
      .string()
      .optional()
      .describe('Pagination cursor from a previous response'),
  }),
  output: z.object({
    users: z.array(UserProfileSchema).describe('Users who liked the post'),
    nextCursor: z
      .string()
      .optional()
      .describe('Cursor for the next page. Absent if no more.'),
  }),
};

export const getRepostersSchema = {
  name: 'getReposters',
  description: 'List the users who reposted (retweeted) a post',
  notes:
    'Prospecting: reposters amplified the post, so they are an even higher-signal topic-qualified audience than likers — pull and rank/qualify them. Use the tweet ID from a list/search/timeline result.',
  input: z.object({
    tweetId: z.string().describe('ID of the tweet'),
    count: z
      .number()
      .optional()
      .default(20)
      .describe('Number of users to fetch (default: 20)'),
    cursor: z
      .string()
      .optional()
      .describe('Pagination cursor from a previous response'),
  }),
  output: z.object({
    users: z.array(UserProfileSchema).describe('Users who reposted the post'),
    nextCursor: z
      .string()
      .optional()
      .describe('Cursor for the next page. Absent if no more.'),
  }),
};

// ============================================================================
// Moderation (block / mute)
// ============================================================================

export const blockUserSchema = {
  name: 'blockUser',
  description: 'Block an X user by their user ID',
  notes: 'Get the user ID from getProfile().profile.id.',
  input: z.object({
    userId: z
      .string()
      .describe('Numeric user ID to block (from getProfile().profile.id)'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the block succeeded'),
  }),
};

export const unblockUserSchema = {
  name: 'unblockUser',
  description: 'Unblock a previously blocked X user by their user ID',
  notes: 'Get the user ID from getProfile().profile.id.',
  input: z.object({
    userId: z
      .string()
      .describe('Numeric user ID to unblock (from getProfile().profile.id)'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the unblock succeeded'),
  }),
};

export const muteUserSchema = {
  name: 'muteUser',
  description: 'Mute an X user by their user ID (hide their posts without blocking)',
  notes: 'Get the user ID from getProfile().profile.id.',
  input: z.object({
    userId: z
      .string()
      .describe('Numeric user ID to mute (from getProfile().profile.id)'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the mute succeeded'),
  }),
};

export const unmuteUserSchema = {
  name: 'unmuteUser',
  description: 'Unmute a previously muted X user by their user ID',
  notes: 'Get the user ID from getProfile().profile.id.',
  input: z.object({
    userId: z
      .string()
      .describe('Numeric user ID to unmute (from getProfile().profile.id)'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the unmute succeeded'),
  }),
};

// ============================================================================
// Trends
// ============================================================================

export const getTrendsSchema = {
  name: 'getTrends',
  description:
    "Get the current trending topics on X, personalized to the authenticated user's own location and interests (the same list shown on the Explore → Trending tab)",
  notes:
    'Trends are personalized server-side to the logged-in account. For trends in a SPECIFIC country or city instead, use getTrendsByLocation (+ listTrendLocations to find the place). To research what a trend is about, pass its name to searchPosts. Promoted (ad) trends are included with promoted=true.',
  input: z.object({
    count: z
      .number()
      .optional()
      .default(20)
      .describe('Number of trends to fetch (default: 20)'),
    translate: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        'When true (default), trends in a non-English script get an English translation in nameEnglish. Set false to skip translation.',
      ),
  }),
  output: z.object({
    trends: z
      .array(
        z.object({
          name: z.string().describe('Trend name / hashtag, in its original language'),
          nameEnglish: z
            .string()
            .optional()
            .describe(
              'English translation of name, present only when the trend is in a non-English script and translation succeeded.',
            ),
          rank: z
            .number()
            .optional()
            .describe('1-based position in the trending list'),
          category: z
            .string()
            .optional()
            .describe(
              'The topic/category a trend is grouped under, cleaned from X\'s label — e.g. "Technology", "Gaming", "Politics", or a location like "United States". Absent when X has not categorized the trend (common on brand-new accounts).',
            ),
          categoryLabel: z
            .string()
            .optional()
            .describe(
              'The raw context line exactly as X shows it under the trend, e.g. "Trending in Technology" or "Gaming · Trending".',
            ),
          postCountLabel: z
            .string()
            .optional()
            .describe(
              'Human-readable post-count label as X shows it, e.g. "45.2K posts". Absent for many trends; for promoted trends this is the "Promoted by …" text.',
            ),
          promoted: z
            .boolean()
            .optional()
            .describe('True if this is a paid/promoted trend rather than organic'),
          url: z
            .string()
            .optional()
            .describe('Web search URL for the trend on x.com'),
        }),
      )
      .describe('Trending topics, in display order'),
  }),
};

export const listTrendLocationsSchema = {
  name: 'listTrendLocations',
  description:
    'List the places X has trend data for (worldwide, countries, and cities), each with a WOEID to pass to getTrendsByLocation',
  notes:
    'Returns ~460 locations. Pass a query to filter by place name or country (e.g. "japan", "united kingdom", "new york"). Use this to find the WOEID for a place, then call getTrendsByLocation.',
  input: z.object({
    query: z
      .string()
      .optional()
      .describe(
        'Case-insensitive filter on location name or country (e.g. "japan", "london"). Omit to list every location.',
      ),
  }),
  output: z.object({
    locations: z
      .array(
        z.object({
          name: z.string().describe('Location name, e.g. "Japan", "London", "Worldwide"'),
          woeid: z.number().describe('WOEID — pass to getTrendsByLocation'),
          country: z
            .string()
            .optional()
            .describe('Country the place is in (empty for Worldwide)'),
          type: z
            .string()
            .optional()
            .describe('Place type, e.g. "Country", "Town", "Supername"'),
        }),
      )
      .describe('Available trend locations'),
  }),
};

export const getTrendsByLocationSchema = {
  name: 'getTrendsByLocation',
  description:
    'Get the trending topics for a SPECIFIC place (country or city) — use this to research what is trending somewhere in particular (e.g. Japan, the UK, New York), as opposed to getTrends which is personalized to your own account',
  notes:
    'Provide either a woeid (from listTrendLocations) or a location name to resolve automatically. Defaults to Worldwide if neither is given. Returns up to ~50 trends. To learn what a trend is about, pass its name to searchPosts (product: "Latest").',
  input: z.object({
    woeid: z
      .number()
      .optional()
      .describe('WOEID of the place (from listTrendLocations). 1 = Worldwide.'),
    location: z
      .string()
      .optional()
      .describe(
        'Place name to resolve to a WOEID when you don\'t have one, e.g. "Japan", "United Kingdom", "New York". Matched against the available locations.',
      ),
    translate: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        'When true (default), trends in a non-English script get an English translation in nameEnglish so foreign-country trends are understandable. Set false to skip translation.',
      ),
  }),
  output: z.object({
    location: z
      .object({
        name: z.string().describe('Resolved place name'),
        woeid: z.number().describe('Resolved WOEID'),
        country: z.string().optional().describe('Country of the place'),
      })
      .describe('The place the trends are for'),
    trends: z
      .array(
        z.object({
          name: z.string().describe('Trend name / hashtag, in its original language'),
          nameEnglish: z
            .string()
            .optional()
            .describe(
              'English translation of name, present only when the trend is in a non-English script and translation succeeded. Use this to understand foreign trends.',
            ),
          rank: z.number().describe('1-based position in this location'),
          postCount: z
            .number()
            .optional()
            .describe('Number of posts, when X provides it (often absent)'),
          promoted: z
            .boolean()
            .optional()
            .describe('True if a promoted/ad trend'),
          url: z.string().optional().describe('Web search URL for the trend'),
        }),
      )
      .describe('Trends for the location, in rank order'),
  }),
};

// ============================================================================
// Lists
// ============================================================================

export const XListSchema = z.object({
  id: z.string().describe('List ID (numeric string)'),
  url: z.string().describe('Direct link to this list on x.com (clickable permalink)'),
  name: z.string().describe('List name'),
  description: z.string().describe('List description (may be empty)'),
  mode: z
    .enum(['Public', 'Private'])
    .describe('Whether the list is Public or Private'),
  memberCount: z.number().describe('Number of accounts on the list'),
  subscriberCount: z.number().describe('Number of accounts following the list'),
  createdAt: z.string().describe('ISO 8601 creation timestamp'),
  following: z
    .boolean()
    .describe('Whether the authenticated user follows (subscribes to) this list'),
  isMember: z
    .boolean()
    .optional()
    .describe('Whether the authenticated user is a member of this list'),
  owner: z
    .object({
      id: z.string().describe('Owner user ID'),
      name: z.string().describe('Owner display name'),
      screenName: z.string().describe('Owner handle without @'),
    })
    .optional()
    .describe('The list owner'),
});

export const getListSchema = {
  name: 'getList',
  description: 'Get details of a list by its ID (name, description, member/subscriber counts, owner)',
  notes: 'Get a listId from listUserLists, or from a list URL (x.com/i/lists/<id>).',
  input: z.object({
    listId: z.string().describe('Numeric list ID'),
  }),
  output: z.object({
    list: XListSchema.describe('List details'),
  }),
};

export const listUserListsSchema = {
  name: 'listUserLists',
  description: 'List the lists owned by a user (their curated lists) — great for finding curated audiences',
  notes: 'Get the userId from getProfile().profile.id. Defaults to the authenticated user.',
  input: z.object({
    userId: z
      .string()
      .optional()
      .describe(
        'Numeric user ID (from getProfile().profile.id). Optional — defaults to the authenticated user.',
      ),
    count: z
      .number()
      .optional()
      .default(20)
      .describe('Number of lists to fetch (default: 20)'),
    cursor: z
      .string()
      .optional()
      .describe('Pagination cursor from a previous response'),
  }),
  output: z.object({
    lists: z.array(XListSchema).describe('Lists owned by the user'),
    nextCursor: z
      .string()
      .optional()
      .describe('Cursor for the next page. Absent if no more.'),
  }),
};

export const getListMembersSchema = {
  name: 'getListMembers',
  description: 'List the accounts that are members of a list — the curated audience itself',
  notes:
    "A hand-curated, topic-qualified audience — often higher-signal than search for finding the right people in a niche. Find relevant lists via listUserLists on a hub account in the space, then mine the members here (rank/qualify with getProfile). Get a listId from listUserLists or getList.",
  input: z.object({
    listId: z.string().describe('Numeric list ID'),
    count: z
      .number()
      .optional()
      .default(20)
      .describe('Number of members to fetch (default: 20)'),
    cursor: z
      .string()
      .optional()
      .describe('Pagination cursor from a previous response'),
  }),
  output: z.object({
    users: z.array(UserProfileSchema).describe('Member profiles'),
    nextCursor: z
      .string()
      .optional()
      .describe('Cursor for the next page. Absent if no more.'),
  }),
};

export const getListTimelineSchema = {
  name: 'getListTimeline',
  description: 'Get the posts (tweets) from the accounts on a list, newest first',
  notes: 'Get a listId from listUserLists or getList. This is the chronological feed of the list.',
  input: z.object({
    listId: z.string().describe('Numeric list ID'),
    count: z
      .number()
      .optional()
      .default(20)
      .describe('Number of posts to fetch (default: 20)'),
    cursor: z
      .string()
      .optional()
      .describe('Pagination cursor from a previous response'),
  }),
  output: z.object({
    posts: z.array(TweetSchema).describe('Posts from accounts on the list'),
    nextCursor: z
      .string()
      .optional()
      .describe('Cursor for the next page. Absent if no more.'),
  }),
};

export const createListSchema = {
  name: 'createList',
  description: 'Create a new list',
  notes: '',
  input: z.object({
    name: z.string().describe('List name'),
    description: z
      .string()
      .optional()
      .default('')
      .describe('List description'),
    isPrivate: z
      .boolean()
      .optional()
      .default(false)
      .describe('Whether the list is private (default: false / public)'),
  }),
  output: z.object({
    list: XListSchema.describe('The created list'),
  }),
};

export const deleteListSchema = {
  name: 'deleteList',
  description: 'Delete a list you own',
  notes: 'Get the listId from listUserLists.',
  input: z.object({
    listId: z.string().describe('Numeric list ID to delete'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the deletion succeeded'),
  }),
};

export const addListMemberSchema = {
  name: 'addListMember',
  description: 'Add a user to a list you own',
  notes: 'Get the userId from getProfile().profile.id and the listId from listUserLists.',
  input: z.object({
    listId: z.string().describe('Numeric list ID'),
    userId: z.string().describe('Numeric user ID to add (from getProfile().profile.id)'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the user was added'),
  }),
};

export const removeListMemberSchema = {
  name: 'removeListMember',
  description: 'Remove a user from a list you own',
  notes: 'Get the userId from getProfile().profile.id and the listId from listUserLists.',
  input: z.object({
    listId: z.string().describe('Numeric list ID'),
    userId: z.string().describe('Numeric user ID to remove'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the user was removed'),
  }),
};

export const followListSchema = {
  name: 'followList',
  description: 'Follow (subscribe to) a list so it appears in your lists',
  notes: 'Get the listId from getList or a list URL.',
  input: z.object({
    listId: z.string().describe('Numeric list ID to follow'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the follow succeeded'),
  }),
};

export const unfollowListSchema = {
  name: 'unfollowList',
  description: 'Unfollow (unsubscribe from) a list',
  notes: '',
  input: z.object({
    listId: z.string().describe('Numeric list ID to unfollow'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the unfollow succeeded'),
  }),
};

// ============================================================================
// Articles (long-form essays)
// ============================================================================

export const ArticleSchema = z.object({
  id: z.string().describe('Article ID (a tweet ID)'),
  title: z.string().describe('Article title'),
  previewText: z
    .string()
    .describe('Short preview/summary shown in the timeline'),
  body: z
    .string()
    .describe(
      'Full article body as readable text. Headers/lists/quotes are rendered as Markdown; embedded posts and images are noted inline.',
    ),
  coverImageUrl: z.string().optional().describe('Cover image URL'),
  author: z
    .object({
      id: z.string().describe('Author user ID'),
      name: z.string().describe('Author display name'),
      screenName: z.string().describe('Author handle without @'),
    })
    .describe('The article author'),
  createdAt: z.string().describe('Publish timestamp, ISO 8601 UTC'),
  url: z.string().describe('Web URL of the article'),
});

export const ArticleSummarySchema = z.object({
  id: z
    .string()
    .describe('Article post id (a tweet id) — pass to getArticle for the full body'),
  title: z.string().describe('Article title'),
  previewText: z.string().describe('Short preview/summary'),
  coverImageUrl: z.string().optional().describe('Cover image URL'),
  createdAt: z.string().describe('Publish timestamp, ISO 8601 UTC'),
  url: z.string().describe('Web URL of the article'),
});

export const getUserArticlesSchema = {
  name: 'getUserArticles',
  description:
    "List the long-form Articles (essays) a user has published. This is how you FIND X Articles: pick an account (a publication or writer), list their articles, then read one with getArticle. NOTE: X has no global article search by topic — Articles are discovered per-account, and most accounts publish none. (Do not confuse with external news links shared in normal posts.)",
  notes:
    'Provide a screenName (handle) or userId; defaults to the authenticated user. Each result has an `id` to pass to getArticle.',
  input: z.object({
    screenName: z
      .string()
      .optional()
      .describe('Handle without @ (e.g. "XData"). Resolved to a user ID automatically.'),
    userId: z
      .string()
      .optional()
      .describe('Numeric user ID (alternative to screenName, from getProfile().profile.id)'),
    count: z
      .number()
      .optional()
      .default(20)
      .describe('Number of articles to fetch (default: 20)'),
    cursor: z
      .string()
      .optional()
      .describe('Pagination cursor from a previous response'),
  }),
  output: z.object({
    articles: z.array(ArticleSummarySchema).describe("The user's published articles"),
    nextCursor: z
      .string()
      .optional()
      .describe('Cursor for the next page. Absent if no more.'),
  }),
};

export const getArticleSchema = {
  name: 'getArticle',
  description:
    'Read a long-form X Article (essay) by its ID — returns the title, full body text, cover image, and author. Articles are the rich-text essays X Premium+ accounts and Verified Organizations publish (distinct from ordinary long posts).',
  notes:
    'The articleId is the numeric ID from an article URL — x.com/i/article/<id> or x.com/<handle>/article/<id> (it is a tweet ID). Anyone can read a published article; no subscription needed.',
  input: z.object({
    articleId: z
      .string()
      .describe('Numeric article ID (from the /i/article/<id> URL; it is a tweet ID)'),
  }),
  output: z.object({
    article: ArticleSchema.describe('The article'),
  }),
};

// ============================================================================
// All Schemas Export
// ============================================================================

export const allSchemas = [
  getContextSchema,
  listMyPostsSchema,
  createPostSchema,
  createPollPostSchema,
  createScheduledPostSchema,
  listScheduledPostsSchema,
  deleteScheduledPostSchema,
  searchPostsSchema,
  likePostSchema,
  createRepostSchema,
  getProfileSchema,
  followUserSchema,
  unfollowUserSchema,
  unlikePostSchema,
  deletePostSchema,
  deleteRepostSchema,
  bookmarkPostSchema,
  unbookmarkPostSchema,
  listBookmarksSchema,
  getForYouTimelineSchema,
  getFollowingTimelineSchema,
  getUserPostsSchema,
  getUserRepliesSchema,
  getUserLikesSchema,
  listNotificationsSchema,
  updateProfileSchema,
  sendDMSchema,
  listDMInboxSchema,
  getDMConversationSchema,
  deleteDMConversationSchema,
  reactToDMSchema,
  removeReactionSchema,
  sendDMImageSchema,
  deleteDMSchema,
  listAccountsSchema,
  switchAccountSchema,
  getPostSchema,
  createThreadSchema,
  editPostSchema,
  pinTweetSchema,
  unpinTweetSchema,
  listFollowersSchema,
  listFollowingSchema,
  searchUsersSchema,
  getLikersSchema,
  getRepostersSchema,
  blockUserSchema,
  unblockUserSchema,
  muteUserSchema,
  unmuteUserSchema,
  getTrendsSchema,
  listTrendLocationsSchema,
  getTrendsByLocationSchema,
  getListSchema,
  listUserListsSchema,
  getListMembersSchema,
  getListTimelineSchema,
  createListSchema,
  deleteListSchema,
  addListMemberSchema,
  removeListMemberSchema,
  followListSchema,
  unfollowListSchema,
  getUserArticlesSchema,
  getArticleSchema,
];

// ============================================================================
// Inferred Types
// ============================================================================

export type Tweet = z.infer<typeof TweetSchema>;
export type UserProfile = z.infer<typeof UserProfileSchema>;
export type GetContextOutput = z.infer<typeof getContextSchema.output>;
export type ListMyPostsOutput = z.infer<typeof listMyPostsSchema.output>;
export type ListMyPostsInput = z.infer<typeof listMyPostsSchema.input>;
export type CreatePostOutput = z.infer<typeof createPostSchema.output>;
export type CreatePostInput = z.infer<typeof createPostSchema.input>;
export type SearchPostsOutput = z.infer<typeof searchPostsSchema.output>;
export type SearchPostsInput = z.infer<typeof searchPostsSchema.input>;
export type LikePostOutput = z.infer<typeof likePostSchema.output>;
export type LikePostInput = z.infer<typeof likePostSchema.input>;
export type CreateRepostOutput = z.infer<typeof createRepostSchema.output>;
export type CreateRepostInput = z.infer<typeof createRepostSchema.input>;
export type GetProfileOutput = z.infer<typeof getProfileSchema.output>;
export type GetProfileInput = z.infer<typeof getProfileSchema.input>;
export type FollowUserOutput = z.infer<typeof followUserSchema.output>;
export type FollowUserInput = z.infer<typeof followUserSchema.input>;
export type UnfollowUserOutput = z.infer<typeof unfollowUserSchema.output>;
export type UnfollowUserInput = z.infer<typeof unfollowUserSchema.input>;
export type UnlikePostInput = z.infer<typeof unlikePostSchema.input>;
export type UnlikePostOutput = z.infer<typeof unlikePostSchema.output>;
export type DeletePostInput = z.infer<typeof deletePostSchema.input>;
export type DeletePostOutput = z.infer<typeof deletePostSchema.output>;
export type DeleteRepostInput = z.infer<typeof deleteRepostSchema.input>;
export type DeleteRepostOutput = z.infer<typeof deleteRepostSchema.output>;
export type BookmarkPostInput = z.infer<typeof bookmarkPostSchema.input>;
export type BookmarkPostOutput = z.infer<typeof bookmarkPostSchema.output>;
export type UnbookmarkPostInput = z.infer<typeof unbookmarkPostSchema.input>;
export type UnbookmarkPostOutput = z.infer<typeof unbookmarkPostSchema.output>;
export type ListBookmarksInput = z.infer<typeof listBookmarksSchema.input>;
export type ListBookmarksOutput = z.infer<typeof listBookmarksSchema.output>;
export type GetForYouTimelineInput = z.infer<
  typeof getForYouTimelineSchema.input
>;
export type GetForYouTimelineOutput = z.infer<
  typeof getForYouTimelineSchema.output
>;
export type GetFollowingTimelineInput = z.infer<
  typeof getFollowingTimelineSchema.input
>;
export type GetFollowingTimelineOutput = z.infer<
  typeof getFollowingTimelineSchema.output
>;
export type GetUserPostsInput = z.infer<typeof getUserPostsSchema.input>;
export type GetUserPostsOutput = z.infer<typeof getUserPostsSchema.output>;
export type GetUserRepliesInput = z.infer<typeof getUserRepliesSchema.input>;
export type GetUserRepliesOutput = z.infer<typeof getUserRepliesSchema.output>;
export type Notification = z.infer<typeof NotificationSchema>;
export type GetUserLikesInput = z.infer<typeof getUserLikesSchema.input>;
export type GetUserLikesOutput = z.infer<typeof getUserLikesSchema.output>;
export type ListNotificationsInput = z.infer<
  typeof listNotificationsSchema.input
>;
export type ListNotificationsOutput = z.infer<
  typeof listNotificationsSchema.output
>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema.input>;
export type UpdateProfileOutput = z.infer<typeof updateProfileSchema.output>;
export type DMConversation = z.infer<typeof DMConversationSchema>;
export type SendDMInput = z.infer<typeof sendDMSchema.input>;
export type SendDMOutput = z.infer<typeof sendDMSchema.output>;
export type ListDMInboxInput = z.infer<typeof listDMInboxSchema.input>;
export type ListDMInboxOutput = z.infer<typeof listDMInboxSchema.output>;
export type CreatePollPostInput = z.infer<typeof createPollPostSchema.input>;
export type CreatePollPostOutput = z.infer<typeof createPollPostSchema.output>;
export type CreateScheduledPostInput = z.infer<
  typeof createScheduledPostSchema.input
>;
export type CreateScheduledPostOutput = z.infer<
  typeof createScheduledPostSchema.output
>;
export type ListScheduledPostsInput = z.infer<
  typeof listScheduledPostsSchema.input
>;
export type ListScheduledPostsOutput = z.infer<
  typeof listScheduledPostsSchema.output
>;
export type DeleteScheduledPostInput = z.infer<
  typeof deleteScheduledPostSchema.input
>;
export type DeleteScheduledPostOutput = z.infer<
  typeof deleteScheduledPostSchema.output
>;
export type GetDMConversationInput = z.infer<
  typeof getDMConversationSchema.input
>;
export type GetDMConversationOutput = z.infer<
  typeof getDMConversationSchema.output
>;
export type DeleteDMConversationInput = z.infer<
  typeof deleteDMConversationSchema.input
>;
export type DeleteDMConversationOutput = z.infer<
  typeof deleteDMConversationSchema.output
>;
export type ReactToDMInput = z.infer<typeof reactToDMSchema.input>;
export type ReactToDMOutput = z.infer<typeof reactToDMSchema.output>;
export type RemoveReactionInput = z.infer<typeof removeReactionSchema.input>;
export type RemoveReactionOutput = z.infer<typeof removeReactionSchema.output>;
export type SendDMImageInput = z.infer<typeof sendDMImageSchema.input>;
export type SendDMImageOutput = z.infer<typeof sendDMImageSchema.output>;
export type DeleteDMInput = z.infer<typeof deleteDMSchema.input>;
export type DeleteDMOutput = z.infer<typeof deleteDMSchema.output>;
export type ListAccountsInput = z.infer<typeof listAccountsSchema.input>;
export type ListAccountsOutput = z.infer<typeof listAccountsSchema.output>;
export type SwitchAccountInput = z.infer<typeof switchAccountSchema.input>;
export type SwitchAccountOutput = z.infer<typeof switchAccountSchema.output>;
export type GetPostInput = z.infer<typeof getPostSchema.input>;
export type GetPostOutput = z.infer<typeof getPostSchema.output>;
export type CreateThreadInput = z.infer<typeof createThreadSchema.input>;
export type CreateThreadOutput = z.infer<typeof createThreadSchema.output>;
export type EditPostInput = z.infer<typeof editPostSchema.input>;
export type EditPostOutput = z.infer<typeof editPostSchema.output>;
export type PinTweetInput = z.infer<typeof pinTweetSchema.input>;
export type PinTweetOutput = z.infer<typeof pinTweetSchema.output>;
export type UnpinTweetInput = z.infer<typeof unpinTweetSchema.input>;
export type UnpinTweetOutput = z.infer<typeof unpinTweetSchema.output>;
export type ListFollowersInput = z.infer<typeof listFollowersSchema.input>;
export type ListFollowersOutput = z.infer<typeof listFollowersSchema.output>;
export type ListFollowingInput = z.infer<typeof listFollowingSchema.input>;
export type ListFollowingOutput = z.infer<typeof listFollowingSchema.output>;
export type SearchUsersInput = z.infer<typeof searchUsersSchema.input>;
export type SearchUsersOutput = z.infer<typeof searchUsersSchema.output>;
export type GetLikersInput = z.infer<typeof getLikersSchema.input>;
export type GetLikersOutput = z.infer<typeof getLikersSchema.output>;
export type GetRepostersInput = z.infer<typeof getRepostersSchema.input>;
export type GetRepostersOutput = z.infer<typeof getRepostersSchema.output>;
export type BlockUserInput = z.infer<typeof blockUserSchema.input>;
export type BlockUserOutput = z.infer<typeof blockUserSchema.output>;
export type UnblockUserInput = z.infer<typeof unblockUserSchema.input>;
export type UnblockUserOutput = z.infer<typeof unblockUserSchema.output>;
export type MuteUserInput = z.infer<typeof muteUserSchema.input>;
export type MuteUserOutput = z.infer<typeof muteUserSchema.output>;
export type UnmuteUserInput = z.infer<typeof unmuteUserSchema.input>;
export type UnmuteUserOutput = z.infer<typeof unmuteUserSchema.output>;
export type GetTrendsInput = z.infer<typeof getTrendsSchema.input>;
export type GetTrendsOutput = z.infer<typeof getTrendsSchema.output>;
export type ListTrendLocationsInput = z.infer<
  typeof listTrendLocationsSchema.input
>;
export type ListTrendLocationsOutput = z.infer<
  typeof listTrendLocationsSchema.output
>;
export type GetTrendsByLocationInput = z.infer<
  typeof getTrendsByLocationSchema.input
>;
export type GetTrendsByLocationOutput = z.infer<
  typeof getTrendsByLocationSchema.output
>;
export type XList = z.infer<typeof XListSchema>;
export type GetListInput = z.infer<typeof getListSchema.input>;
export type GetListOutput = z.infer<typeof getListSchema.output>;
export type ListUserListsInput = z.infer<typeof listUserListsSchema.input>;
export type ListUserListsOutput = z.infer<typeof listUserListsSchema.output>;
export type GetListMembersInput = z.infer<typeof getListMembersSchema.input>;
export type GetListMembersOutput = z.infer<typeof getListMembersSchema.output>;
export type GetListTimelineInput = z.infer<typeof getListTimelineSchema.input>;
export type GetListTimelineOutput = z.infer<typeof getListTimelineSchema.output>;
export type CreateListInput = z.infer<typeof createListSchema.input>;
export type CreateListOutput = z.infer<typeof createListSchema.output>;
export type DeleteListInput = z.infer<typeof deleteListSchema.input>;
export type DeleteListOutput = z.infer<typeof deleteListSchema.output>;
export type AddListMemberInput = z.infer<typeof addListMemberSchema.input>;
export type AddListMemberOutput = z.infer<typeof addListMemberSchema.output>;
export type RemoveListMemberInput = z.infer<typeof removeListMemberSchema.input>;
export type RemoveListMemberOutput = z.infer<
  typeof removeListMemberSchema.output
>;
export type FollowListInput = z.infer<typeof followListSchema.input>;
export type FollowListOutput = z.infer<typeof followListSchema.output>;
export type UnfollowListInput = z.infer<typeof unfollowListSchema.input>;
export type UnfollowListOutput = z.infer<typeof unfollowListSchema.output>;
export type Article = z.infer<typeof ArticleSchema>;
export type ArticleSummary = z.infer<typeof ArticleSummarySchema>;
export type GetArticleInput = z.infer<typeof getArticleSchema.input>;
export type GetArticleOutput = z.infer<typeof getArticleSchema.output>;
export type GetUserArticlesInput = z.infer<typeof getUserArticlesSchema.input>;
export type GetUserArticlesOutput = z.infer<typeof getUserArticlesSchema.output>;
