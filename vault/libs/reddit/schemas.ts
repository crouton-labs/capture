import { z } from 'zod';

export const libraryDescription =
  'Reddit browsing, posting, commenting, voting, and community management via internal JSON API';

export const libraryIcon =
  'https://www.redditstatic.com/shreddit/assets/favicon/64x64.png';
export const loginUrl = 'https://www.reddit.com/login';

export const libraryNotes = `
## Workflow

1. Navigate to any \`www.reddit.com\` page
2. Call \`getContext()\` to extract session auth (modhash, csrf, username)
3. Use returned \`modhash\` for all write operations (vote, comment, subscribe, etc.)

## Key Concepts

**Thing IDs**: Reddit entities use type-prefixed IDs called "fullnames":
- \`t1_xxx\` = comment
- \`t2_xxx\` = user account
- \`t3_xxx\` = post (link)
- \`t4_xxx\` = message
- \`t5_xxx\` = subreddit

**Pagination**: Uses \`after\` cursor (the fullname of the last item). Pass the \`after\` value from the response to get the next page.

**Sorting**: Feeds support \`hot\`, \`new\`, \`top\`, \`rising\`, \`controversial\`. Top/controversial also accept \`t\` (time period): \`hour\`, \`day\`, \`week\`, \`month\`, \`year\`, \`all\`.

**Write operations**: All writes (vote, comment, subscribe, save, message) require the \`modhash\` from \`getContext()\`.
`;

// ============================================================================
// Rate Limits
// ============================================================================

export const rateLimits: Record<
  string,
  Array<{
    window: 'SECOND' | 'MINUTE' | 'HOUR' | 'DAY';
    maxCalls: number;
    message: string;
  }>
> = {
  comment: [
    {
      window: 'SECOND',
      maxCalls: 1,
      message: 'Reddit throttles ~1 comment/sec',
    },
    {
      window: 'MINUTE',
      maxCalls: 5,
      message: 'Comment bursts trigger shadowban',
    },
    { window: 'HOUR', maxCalls: 60, message: 'Hourly comment ceiling' },
  ],
  submitPost: [
    { window: 'HOUR', maxCalls: 3, message: '>3 posts/hr reads as spam' },
    { window: 'DAY', maxCalls: 10, message: 'Daily post cap' },
  ],
  vote: [
    {
      window: 'MINUTE',
      maxCalls: 30,
      message: 'Vote-manipulation suspensions trigger fast',
    },
  ],
  sendMessage: [
    { window: 'HOUR', maxCalls: 10, message: 'Reddit DM cap before anti-spam' },
    { window: 'DAY', maxCalls: 50, message: 'Daily DM cap' },
  ],
};

// ============================================================================
// Context
// ============================================================================

export const getContextSchema = {
  name: 'getContext',
  description:
    'Extract session auth from Reddit: call FIRST before any other function. Returns modhash needed for write operations.',
  notes: '',
  input: z.object({}),
  output: z.object({
    modhash: z.string().describe('CSRF modhash for write operations'),
    csrfToken: z.string().describe('CSRF token from cookie'),
    username: z.string().describe('Logged-in Reddit username'),
  }),
};
export type GetContextInput = z.infer<typeof getContextSchema.input>;
export type GetContextOutput = z.infer<typeof getContextSchema.output>;

// ============================================================================
// User
// ============================================================================

export const getMeSchema = {
  name: 'getMe',
  description:
    'Get current logged-in user profile including karma, account age, and preferences.',
  notes: '',
  input: z.object({
    modhash: z.string().describe('Modhash from getContext'),
  }),
  output: z.object({
    name: z.string().describe('Username'),
    id: z.string().describe('User fullname (t2_xxx)'),
    totalKarma: z.number().describe('Total karma score'),
    linkKarma: z.number().describe('Post karma'),
    commentKarma: z.number().describe('Comment karma'),
    createdUtc: z.number().describe('Account creation timestamp (unix)'),
    hasVerifiedEmail: z.boolean(),
    isGold: z.boolean().describe('Has Reddit Premium'),
    isMod: z.boolean().describe('Is a moderator of any subreddit'),
    iconUrl: z.string().describe('Profile icon URL'),
  }),
};
export type GetMeInput = z.infer<typeof getMeSchema.input>;
export type GetMeOutput = z.infer<typeof getMeSchema.output>;

export const getUserProfileSchema = {
  name: 'getUserProfile',
  description:
    'Get public profile information for any Reddit user by username.',
  notes: '',
  input: z.object({
    username: z.string().describe('Reddit username (without u/ prefix)'),
  }),
  output: z.object({
    name: z.string().describe('Username'),
    id: z.string().describe('User fullname (t2_xxx)'),
    totalKarma: z.number().describe('Total karma'),
    linkKarma: z.number().describe('Post karma'),
    commentKarma: z.number().describe('Comment karma'),
    createdUtc: z.number().describe('Account creation timestamp (unix)'),
    subreddit: z.object({
      displayName: z.string().describe('User profile subreddit name'),
      title: z.string().describe('Profile display name'),
      publicDescription: z.string().describe('Profile bio'),
    }),
    iconUrl: z.string().describe('Profile icon URL'),
  }),
};
export type GetUserProfileInput = z.infer<typeof getUserProfileSchema.input>;
export type GetUserProfileOutput = z.infer<typeof getUserProfileSchema.output>;

// ============================================================================
// Feed & Posts
// ============================================================================

const postSchema = z.object({
  id: z.string().describe('Post ID (without t3_ prefix)'),
  name: z.string().describe('Post fullname (t3_xxx)'),
  title: z.string(),
  author: z.string(),
  subreddit: z.string().describe('Subreddit name (without r/ prefix)'),
  selftext: z.string().describe('Post body text (empty for link posts)'),
  url: z.string().describe('Post URL (self-post URL or external link)'),
  permalink: z.string().describe('Reddit permalink path'),
  score: z.number().describe('Net upvotes'),
  upvoteRatio: z.number().describe('Ratio of upvotes (0.0 to 1.0)'),
  numComments: z.number(),
  createdUtc: z.number().describe('Creation timestamp (unix)'),
  isSelf: z.boolean().describe('True if self/text post, false if link post'),
  over18: z.boolean().describe('NSFW flag'),
  stickied: z.boolean(),
  locked: z.boolean(),
  saved: z.boolean().describe('Whether current user has saved this'),
  likes: z
    .boolean()
    .nullable()
    .describe('true=upvoted, false=downvoted, null=no vote'),
});

export const getFeedSchema = {
  name: 'getFeed',
  description:
    'Get posts from a subreddit feed. Supports hot, new, top, rising, and controversial sorting.',
  notes: '',
  input: z.object({
    subreddit: z
      .string()
      .describe('Subreddit name without r/ prefix (e.g. "programming")'),
    sort: z
      .enum(['hot', 'new', 'top', 'rising', 'controversial'])
      .optional()
      .default('hot')
      .describe('Sort order'),
    t: z
      .enum(['hour', 'day', 'week', 'month', 'year', 'all'])
      .optional()
      .describe('Time period for top/controversial sorting'),
    limit: z
      .number()
      .optional()
      .default(25)
      .describe('Number of posts (max 100)'),
    after: z
      .string()
      .optional()
      .describe('Pagination cursor (fullname of last item)'),
  }),
  output: z.object({
    posts: z.array(postSchema),
    after: z
      .string()
      .nullable()
      .describe('Cursor for next page, null if no more'),
  }),
};
export type GetFeedInput = z.infer<typeof getFeedSchema.input>;
export type GetFeedOutput = z.infer<typeof getFeedSchema.output>;

export const getPostSchema = {
  name: 'getPost',
  description:
    'Get a single post with its comments. Returns the post details and a tree of comments.',
  notes: '',
  input: z.object({
    subreddit: z.string().describe('Subreddit name without r/ prefix'),
    postId: z.string().describe('Post ID (without t3_ prefix, e.g. "1qoxwdt")'),
    sort: z
      .enum(['best', 'top', 'new', 'controversial', 'old', 'qa'])
      .optional()
      .default('best')
      .describe('Comment sort order'),
    limit: z.number().optional().default(50).describe('Max comments to return'),
  }),
  output: z.object({
    post: postSchema,
    comments: z.array(
      z.object({
        id: z.string().describe('Comment ID (without t1_ prefix)'),
        name: z.string().describe('Comment fullname (t1_xxx)'),
        author: z.string(),
        body: z.string().describe('Comment text (markdown)'),
        score: z.number(),
        createdUtc: z.number(),
        parentId: z
          .string()
          .describe('Parent fullname (t3_ for top-level, t1_ for reply)'),
        depth: z.number().describe('Nesting depth (0 = top-level)'),
        likes: z
          .boolean()
          .nullable()
          .describe('true=upvoted, false=downvoted, null=no vote'),
        saved: z.boolean(),
        stickied: z.boolean(),
      }),
    ),
  }),
};
export type GetPostInput = z.infer<typeof getPostSchema.input>;
export type GetPostOutput = z.infer<typeof getPostSchema.output>;

// ============================================================================
// Search
// ============================================================================

export const searchPostsSchema = {
  name: 'searchPosts',
  description:
    'Search Reddit for posts matching a query. Can filter by subreddit.',
  notes: '',
  input: z.object({
    query: z.string().describe('Search query'),
    subreddit: z
      .string()
      .optional()
      .describe('Restrict search to this subreddit'),
    sort: z
      .enum(['relevance', 'hot', 'top', 'new', 'comments'])
      .optional()
      .default('relevance'),
    t: z
      .enum(['hour', 'day', 'week', 'month', 'year', 'all'])
      .optional()
      .default('all')
      .describe('Time period filter'),
    limit: z.number().optional().default(25).describe('Max results (max 100)'),
    after: z.string().optional().describe('Pagination cursor'),
  }),
  output: z.object({
    posts: z.array(postSchema),
    after: z.string().nullable().describe('Cursor for next page'),
  }),
};
export type SearchPostsInput = z.infer<typeof searchPostsSchema.input>;
export type SearchPostsOutput = z.infer<typeof searchPostsSchema.output>;

export const searchSubredditsSchema = {
  name: 'searchSubreddits',
  description: 'Search for subreddits by name or topic.',
  notes: '',
  input: z.object({
    query: z.string().describe('Search query'),
    limit: z.number().optional().default(10).describe('Max results (max 100)'),
    after: z.string().optional().describe('Pagination cursor'),
  }),
  output: z.object({
    subreddits: z.array(
      z.object({
        name: z.string().describe('Subreddit name (without r/)'),
        fullname: z.string().describe('Subreddit fullname (t5_xxx)'),
        title: z.string().describe('Display title'),
        publicDescription: z.string().describe('Short description'),
        subscribers: z.number(),
        activeUserCount: z.number().nullable().describe('Current active users'),
        over18: z.boolean().describe('NSFW subreddit'),
        url: z.string().describe('Subreddit URL path (e.g. /r/programming/)'),
      }),
    ),
    after: z.string().nullable(),
  }),
};
export type SearchSubredditsInput = z.infer<
  typeof searchSubredditsSchema.input
>;
export type SearchSubredditsOutput = z.infer<
  typeof searchSubredditsSchema.output
>;

// ============================================================================
// Subreddit
// ============================================================================

export const getSubredditSchema = {
  name: 'getSubreddit',
  description:
    'Get detailed information about a subreddit including rules, description, and stats.',
  notes: '',
  input: z.object({
    subreddit: z.string().describe('Subreddit name without r/ prefix'),
  }),
  output: z.object({
    name: z.string().describe('Subreddit name'),
    fullname: z.string().describe('Subreddit fullname (t5_xxx)'),
    title: z.string().describe('Display title'),
    publicDescription: z.string(),
    description: z.string().describe('Full sidebar description (markdown)'),
    subscribers: z.number(),
    activeUserCount: z.number().nullable(),
    createdUtc: z.number(),
    over18: z.boolean(),
    url: z.string(),
    bannerImg: z.string().describe('Banner image URL'),
    iconImg: z.string().describe('Icon image URL'),
    userIsSubscriber: z
      .boolean()
      .nullable()
      .describe('Whether current user is subscribed'),
    userIsModerator: z.boolean().nullable(),
  }),
};
export type GetSubredditInput = z.infer<typeof getSubredditSchema.input>;
export type GetSubredditOutput = z.infer<typeof getSubredditSchema.output>;

// ============================================================================
// User Content
// ============================================================================

export const getUserPostsSchema = {
  name: 'getUserPosts',
  description: 'Get posts submitted by a specific Reddit user.',
  notes: '',
  input: z.object({
    username: z.string().describe('Reddit username'),
    sort: z
      .enum(['hot', 'new', 'top', 'controversial'])
      .optional()
      .default('new'),
    t: z.enum(['hour', 'day', 'week', 'month', 'year', 'all']).optional(),
    limit: z.number().optional().default(25),
    after: z.string().optional(),
  }),
  output: z.object({
    posts: z.array(postSchema),
    after: z.string().nullable(),
  }),
};
export type GetUserPostsInput = z.infer<typeof getUserPostsSchema.input>;
export type GetUserPostsOutput = z.infer<typeof getUserPostsSchema.output>;

export const getUserCommentsSchema = {
  name: 'getUserComments',
  description: 'Get comments made by a specific Reddit user.',
  notes: '',
  input: z.object({
    username: z.string().describe('Reddit username'),
    sort: z
      .enum(['hot', 'new', 'top', 'controversial'])
      .optional()
      .default('new'),
    t: z.enum(['hour', 'day', 'week', 'month', 'year', 'all']).optional(),
    limit: z.number().optional().default(25),
    after: z.string().optional(),
  }),
  output: z.object({
    comments: z.array(
      z.object({
        id: z.string(),
        name: z.string().describe('Comment fullname (t1_xxx)'),
        author: z.string(),
        body: z.string(),
        score: z.number(),
        createdUtc: z.number(),
        subreddit: z.string(),
        linkTitle: z.string().describe('Title of the parent post'),
        linkId: z.string().describe('Parent post fullname (t3_xxx)'),
        permalink: z.string(),
      }),
    ),
    after: z.string().nullable(),
  }),
};
export type GetUserCommentsInput = z.infer<typeof getUserCommentsSchema.input>;
export type GetUserCommentsOutput = z.infer<
  typeof getUserCommentsSchema.output
>;

// ============================================================================
// Write Operations
// ============================================================================

export const voteSchema = {
  name: 'vote',
  description:
    'Upvote, downvote, or remove vote on a post or comment. Use the fullname (t1_ or t3_ prefixed ID).',
  notes: '',
  input: z.object({
    modhash: z.string().describe('Modhash from getContext'),
    id: z
      .string()
      .describe(
        'Fullname of thing to vote on (t1_xxx for comment, t3_xxx for post)',
      ),
    dir: z
      .enum(['1', '0', '-1'])
      .describe('Vote direction: 1=upvote, 0=unvote, -1=downvote'),
  }),
  output: z.object({
    success: z.boolean(),
  }),
};
export type VoteInput = z.infer<typeof voteSchema.input>;
export type VoteOutput = z.infer<typeof voteSchema.output>;

export const commentSchema = {
  name: 'comment',
  description:
    'Post a comment on a post or reply to an existing comment. Use the fullname of the parent.',
  notes: '',
  input: z.object({
    modhash: z.string().describe('Modhash from getContext'),
    parentId: z
      .string()
      .describe(
        'Fullname of parent (t3_xxx for post, t1_xxx for comment reply)',
      ),
    text: z.string().describe('Comment body (supports markdown)'),
  }),
  output: z.object({
    id: z.string().describe('New comment fullname (t1_xxx)'),
    author: z.string(),
    body: z.string(),
    createdUtc: z.number(),
  }),
};
export type CommentInput = z.infer<typeof commentSchema.input>;
export type CommentOutput = z.infer<typeof commentSchema.output>;

export const subscribeSchema = {
  name: 'subscribe',
  description: 'Subscribe to or unsubscribe from a subreddit.',
  notes: '',
  input: z.object({
    modhash: z.string().describe('Modhash from getContext'),
    subreddit: z
      .string()
      .describe('Subreddit fullname (t5_xxx) or display name'),
    action: z.enum(['sub', 'unsub']).describe('Subscribe or unsubscribe'),
  }),
  output: z.object({
    success: z.boolean(),
  }),
};
export type SubscribeInput = z.infer<typeof subscribeSchema.input>;
export type SubscribeOutput = z.infer<typeof subscribeSchema.output>;

export const saveItemSchema = {
  name: 'saveItem',
  description: 'Save or unsave a post or comment to your saved items.',
  notes: '',
  input: z.object({
    modhash: z.string().describe('Modhash from getContext'),
    id: z.string().describe('Fullname of thing to save (t1_xxx or t3_xxx)'),
    unsave: z
      .boolean()
      .optional()
      .default(false)
      .describe('Set true to unsave'),
  }),
  output: z.object({
    success: z.boolean(),
  }),
};
export type SaveItemInput = z.infer<typeof saveItemSchema.input>;
export type SaveItemOutput = z.infer<typeof saveItemSchema.output>;

export const submitPostSchema = {
  name: 'submitPost',
  description: 'Submit a new text post or link post to a subreddit.',
  notes:
    'New or low-karma accounts may hit a CAPTCHA error. If so, submit via the Reddit UI instead.',
  input: z.object({
    modhash: z.string().describe('Modhash from getContext'),
    subreddit: z.string().describe('Subreddit name without r/ prefix'),
    title: z.string().describe('Post title'),
    text: z
      .string()
      .optional()
      .describe('Post body for self/text posts (markdown)'),
    url: z
      .string()
      .optional()
      .describe('URL for link posts (omit for text posts)'),
  }),
  output: z.object({
    id: z.string().describe('New post fullname (t3_xxx)'),
    url: z.string().describe('URL of the new post'),
  }),
};
export type SubmitPostInput = z.infer<typeof submitPostSchema.input>;
export type SubmitPostOutput = z.infer<typeof submitPostSchema.output>;

export const sendMessageSchema = {
  name: 'sendMessage',
  description: 'Send a private message to another Reddit user.',
  notes: '',
  input: z.object({
    modhash: z.string().describe('Modhash from getContext'),
    to: z.string().describe('Recipient username'),
    subject: z.string().describe('Message subject'),
    body: z.string().describe('Message body (markdown)'),
  }),
  output: z.object({
    success: z.boolean(),
  }),
};
export type SendMessageInput = z.infer<typeof sendMessageSchema.input>;
export type SendMessageOutput = z.infer<typeof sendMessageSchema.output>;

export const getInboxSchema = {
  name: 'getInbox',
  description:
    'Get inbox messages including private messages and comment replies.',
  notes: '',
  input: z.object({
    modhash: z.string().describe('Modhash from getContext'),
    category: z
      .enum([
        'inbox',
        'unread',
        'messages',
        'comments',
        'selfreply',
        'mentions',
      ])
      .optional()
      .default('inbox')
      .describe('Message category to fetch'),
    limit: z.number().optional().default(25),
    after: z.string().optional(),
  }),
  output: z.object({
    messages: z.array(
      z.object({
        id: z.string().describe('Message fullname'),
        author: z.string(),
        subject: z.string(),
        body: z.string(),
        createdUtc: z.number(),
        isNew: z.boolean().describe('Unread'),
        type: z
          .string()
          .describe('Message type (e.g. t1 for comment, t4 for message)'),
      }),
    ),
    after: z.string().nullable(),
  }),
};
export type GetInboxInput = z.infer<typeof getInboxSchema.input>;
export type GetInboxOutput = z.infer<typeof getInboxSchema.output>;

// ============================================================================
// Edit & Delete
// ============================================================================

export const editPostSchema = {
  name: 'editPost',
  description: 'Edit the body text of an existing self/text post you authored.',
  notes: 'Only works on self posts (not link posts). You must be the author.',
  input: z.object({
    modhash: z.string().describe('Modhash from getContext'),
    id: z.string().describe('Post fullname (t3_xxx)'),
    text: z.string().describe('New post body (markdown, replaces entire body)'),
  }),
  output: z.object({
    success: z.boolean(),
    body: z.string().describe('Updated post body'),
  }),
};
export type EditPostInput = z.infer<typeof editPostSchema.input>;
export type EditPostOutput = z.infer<typeof editPostSchema.output>;

export const deletePostSchema = {
  name: 'deletePost',
  description: 'Delete a post you authored. This is irreversible.',
  notes: '',
  input: z.object({
    modhash: z.string().describe('Modhash from getContext'),
    id: z.string().describe('Post fullname (t3_xxx)'),
  }),
  output: z.object({
    success: z.boolean(),
  }),
};
export type DeletePostInput = z.infer<typeof deletePostSchema.input>;
export type DeletePostOutput = z.infer<typeof deletePostSchema.output>;

export const editCommentSchema = {
  name: 'editComment',
  description: 'Edit an existing comment you authored.',
  notes: '',
  input: z.object({
    modhash: z.string().describe('Modhash from getContext'),
    id: z.string().describe('Comment fullname (t1_xxx)'),
    text: z
      .string()
      .describe('New comment body (markdown, replaces entire body)'),
  }),
  output: z.object({
    success: z.boolean(),
    body: z.string().describe('Updated comment body'),
  }),
};
export type EditCommentInput = z.infer<typeof editCommentSchema.input>;
export type EditCommentOutput = z.infer<typeof editCommentSchema.output>;

export const deleteCommentSchema = {
  name: 'deleteComment',
  description:
    'Delete a comment you authored. The comment text is replaced with [deleted].',
  notes: '',
  input: z.object({
    modhash: z.string().describe('Modhash from getContext'),
    id: z.string().describe('Comment fullname (t1_xxx)'),
  }),
  output: z.object({
    success: z.boolean(),
  }),
};
export type DeleteCommentInput = z.infer<typeof deleteCommentSchema.input>;
export type DeleteCommentOutput = z.infer<typeof deleteCommentSchema.output>;

// ============================================================================
// Post Visibility
// ============================================================================

export const hidePostSchema = {
  name: 'hidePost',
  description: 'Hide or unhide a post from your feed.',
  notes: '',
  input: z.object({
    modhash: z.string().describe('Modhash from getContext'),
    id: z.string().describe('Post fullname (t3_xxx)'),
    unhide: z
      .boolean()
      .optional()
      .default(false)
      .describe('Set true to unhide'),
  }),
  output: z.object({
    success: z.boolean(),
  }),
};
export type HidePostInput = z.infer<typeof hidePostSchema.input>;
export type HidePostOutput = z.infer<typeof hidePostSchema.output>;

// ============================================================================
// Message Management
// ============================================================================

export const markReadSchema = {
  name: 'markRead',
  description: 'Mark inbox messages as read or unread.',
  notes: '',
  input: z.object({
    modhash: z.string().describe('Modhash from getContext'),
    ids: z
      .array(z.string())
      .describe('Array of message fullnames (t1_xxx or t4_xxx)'),
    unread: z
      .boolean()
      .optional()
      .default(false)
      .describe('Set true to mark as unread instead'),
  }),
  output: z.object({
    success: z.boolean(),
  }),
};
export type MarkReadInput = z.infer<typeof markReadSchema.input>;
export type MarkReadOutput = z.infer<typeof markReadSchema.output>;

export const deleteMessageSchema = {
  name: 'deleteMessage',
  description: 'Delete a private message from your inbox.',
  notes: '',
  input: z.object({
    modhash: z.string().describe('Modhash from getContext'),
    id: z.string().describe('Message fullname (t4_xxx)'),
  }),
  output: z.object({
    success: z.boolean(),
  }),
};
export type DeleteMessageInput = z.infer<typeof deleteMessageSchema.input>;
export type DeleteMessageOutput = z.infer<typeof deleteMessageSchema.output>;

// ============================================================================
// Engagement History
// ============================================================================

export const getSavedSchema = {
  name: 'getSaved',
  description: 'Get posts and comments the current user has saved.',
  notes: '',
  input: z.object({
    username: z.string().describe('Your Reddit username'),
    limit: z.number().optional().default(25),
    after: z.string().optional(),
  }),
  output: z.object({
    items: z.array(
      z.object({
        kind: z.string().describe('t1 for comment, t3 for post'),
        id: z.string().describe('Item fullname'),
        title: z.string().describe('Post title (empty for comments)'),
        body: z.string().describe('Comment body or post selftext'),
        author: z.string(),
        subreddit: z.string(),
        score: z.number(),
        createdUtc: z.number(),
        permalink: z.string(),
      }),
    ),
    after: z.string().nullable(),
  }),
};
export type GetSavedInput = z.infer<typeof getSavedSchema.input>;
export type GetSavedOutput = z.infer<typeof getSavedSchema.output>;

export const getUpvotedSchema = {
  name: 'getUpvoted',
  description: 'Get posts and comments the current user has upvoted.',
  notes: '',
  input: z.object({
    username: z.string().describe('Your Reddit username'),
    limit: z.number().optional().default(25),
    after: z.string().optional(),
  }),
  output: z.object({
    items: z.array(
      z.object({
        kind: z.string().describe('t1 for comment, t3 for post'),
        id: z.string().describe('Item fullname'),
        title: z.string(),
        author: z.string(),
        subreddit: z.string(),
        score: z.number(),
        createdUtc: z.number(),
        permalink: z.string(),
      }),
    ),
    after: z.string().nullable(),
  }),
};
export type GetUpvotedInput = z.infer<typeof getUpvotedSchema.input>;
export type GetUpvotedOutput = z.infer<typeof getUpvotedSchema.output>;

export const getDownvotedSchema = {
  name: 'getDownvoted',
  description: 'Get posts and comments the current user has downvoted.',
  notes: '',
  input: z.object({
    username: z.string().describe('Your Reddit username'),
    limit: z.number().optional().default(25),
    after: z.string().optional(),
  }),
  output: z.object({
    items: z.array(
      z.object({
        kind: z.string().describe('t1 for comment, t3 for post'),
        id: z.string().describe('Item fullname'),
        title: z.string(),
        author: z.string(),
        subreddit: z.string(),
        score: z.number(),
        createdUtc: z.number(),
        permalink: z.string(),
      }),
    ),
    after: z.string().nullable(),
  }),
};
export type GetDownvotedInput = z.infer<typeof getDownvotedSchema.input>;
export type GetDownvotedOutput = z.infer<typeof getDownvotedSchema.output>;

export const getHiddenSchema = {
  name: 'getHidden',
  description: 'Get posts the current user has hidden from their feed.',
  notes: '',
  input: z.object({
    username: z.string().describe('Your Reddit username'),
    limit: z.number().optional().default(25),
    after: z.string().optional(),
  }),
  output: z.object({
    posts: z.array(postSchema),
    after: z.string().nullable(),
  }),
};
export type GetHiddenInput = z.infer<typeof getHiddenSchema.input>;
export type GetHiddenOutput = z.infer<typeof getHiddenSchema.output>;

// ============================================================================
// Subreddit Details
// ============================================================================

export const getSubredditRulesSchema = {
  name: 'getSubredditRules',
  description:
    'Get the posting rules for a subreddit. Useful before submitting a post.',
  notes: '',
  input: z.object({
    subreddit: z.string().describe('Subreddit name without r/ prefix'),
  }),
  output: z.object({
    rules: z.array(
      z.object({
        shortName: z.string().describe('Rule title'),
        description: z.string().describe('Rule details (markdown)'),
        kind: z
          .string()
          .describe('What the rule applies to: comment, link, or all'),
        priority: z.number().describe('Rule order (0 = first)'),
      }),
    ),
    siteRules: z.array(z.string()).describe('Global Reddit site rules'),
  }),
};
export type GetSubredditRulesInput = z.infer<
  typeof getSubredditRulesSchema.input
>;
export type GetSubredditRulesOutput = z.infer<
  typeof getSubredditRulesSchema.output
>;

export const getPostFlairsSchema = {
  name: 'getPostFlairs',
  description: 'Get available post flairs for a subreddit.',
  notes: '',
  input: z.object({
    subreddit: z.string().describe('Subreddit name without r/ prefix'),
  }),
  output: z.object({
    flairs: z.array(
      z.object({
        id: z.string().describe('Flair template ID'),
        text: z.string().describe('Flair display text'),
        textEditable: z
          .boolean()
          .describe('Whether the text can be customized'),
        backgroundColor: z.string().describe('Flair background color hex'),
        textColor: z.string().describe('Text color: light or dark'),
      }),
    ),
  }),
};
export type GetPostFlairsInput = z.infer<typeof getPostFlairsSchema.input>;
export type GetPostFlairsOutput = z.infer<typeof getPostFlairsSchema.output>;

// ============================================================================
// User Engagement
// ============================================================================

export const reportSchema = {
  name: 'report',
  description: 'Report a post or comment for violating rules.',
  notes: '',
  input: z.object({
    modhash: z.string().describe('Modhash from getContext'),
    id: z.string().describe('Fullname of item to report (t1_xxx or t3_xxx)'),
    reason: z.string().describe('Report reason text'),
  }),
  output: z.object({
    success: z.boolean(),
  }),
};
export type ReportInput = z.infer<typeof reportSchema.input>;
export type ReportOutput = z.infer<typeof reportSchema.output>;

export const blockUserSchema = {
  name: 'blockUser',
  description:
    'Block a Reddit user. You will no longer see their posts or comments.',
  notes: '',
  input: z.object({
    modhash: z.string().describe('Modhash from getContext'),
    username: z.string().describe('Username to block'),
  }),
  output: z.object({
    success: z.boolean(),
  }),
};
export type BlockUserInput = z.infer<typeof blockUserSchema.input>;
export type BlockUserOutput = z.infer<typeof blockUserSchema.output>;

export const followUserSchema = {
  name: 'followUser',
  description: 'Follow a Reddit user to see their posts in your home feed.',
  notes: '',
  input: z.object({
    modhash: z.string().describe('Modhash from getContext'),
    username: z.string().describe('Username to follow'),
    unfollow: z
      .boolean()
      .optional()
      .default(false)
      .describe('Set true to unfollow'),
  }),
  output: z.object({
    success: z.boolean(),
  }),
};
export type FollowUserInput = z.infer<typeof followUserSchema.input>;
export type FollowUserOutput = z.infer<typeof followUserSchema.output>;

export const toggleInboxRepliesSchema = {
  name: 'toggleInboxReplies',
  description:
    'Enable or disable inbox notifications for replies to your post or comment.',
  notes: '',
  input: z.object({
    modhash: z.string().describe('Modhash from getContext'),
    id: z
      .string()
      .describe('Fullname of your post or comment (t1_xxx or t3_xxx)'),
    state: z
      .boolean()
      .describe('true = receive replies in inbox, false = disable'),
  }),
  output: z.object({
    success: z.boolean(),
  }),
};
export type ToggleInboxRepliesInput = z.infer<
  typeof toggleInboxRepliesSchema.input
>;
export type ToggleInboxRepliesOutput = z.infer<
  typeof toggleInboxRepliesSchema.output
>;

export const crosspostSchema = {
  name: 'crosspost',
  description: 'Crosspost an existing post to another subreddit.',
  notes: 'New or low-karma accounts may hit a CAPTCHA error.',
  input: z.object({
    modhash: z.string().describe('Modhash from getContext'),
    originalPostId: z
      .string()
      .describe('Fullname of post to crosspost (t3_xxx)'),
    subreddit: z.string().describe('Target subreddit name without r/ prefix'),
    title: z.string().describe('Title for the crosspost'),
  }),
  output: z.object({
    id: z.string().describe('New crosspost fullname (t3_xxx)'),
    url: z.string().describe('URL of the crosspost'),
  }),
};
export type CrosspostInput = z.infer<typeof crosspostSchema.input>;
export type CrosspostOutput = z.infer<typeof crosspostSchema.output>;

// ============================================================================
// All Schemas
// ============================================================================

export const allSchemas = [
  getContextSchema,
  getMeSchema,
  getUserProfileSchema,
  getFeedSchema,
  getPostSchema,
  searchPostsSchema,
  searchSubredditsSchema,
  getSubredditSchema,
  getSubredditRulesSchema,
  getPostFlairsSchema,
  getUserPostsSchema,
  getUserCommentsSchema,
  getSavedSchema,
  getUpvotedSchema,
  getDownvotedSchema,
  getHiddenSchema,
  voteSchema,
  commentSchema,
  subscribeSchema,
  saveItemSchema,
  submitPostSchema,
  crosspostSchema,
  sendMessageSchema,
  getInboxSchema,
  editPostSchema,
  deletePostSchema,
  editCommentSchema,
  deleteCommentSchema,
  hidePostSchema,
  reportSchema,
  blockUserSchema,
  followUserSchema,
  toggleInboxRepliesSchema,
  markReadSchema,
  deleteMessageSchema,
];
