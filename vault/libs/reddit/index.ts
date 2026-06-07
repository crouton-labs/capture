import { Unauthenticated, UpstreamError, ContractDrift, throwForStatus } from '@vallum/_runtime';

import type {
  GetContextOutput,
  GetMeInput,
  GetMeOutput,
  GetUserProfileInput,
  GetUserProfileOutput,
  GetFeedInput,
  GetFeedOutput,
  GetPostInput,
  GetPostOutput,
  SearchPostsInput,
  SearchPostsOutput,
  SearchSubredditsInput,
  SearchSubredditsOutput,
  GetSubredditInput,
  GetSubredditOutput,
  GetUserPostsInput,
  GetUserPostsOutput,
  GetUserCommentsInput,
  GetUserCommentsOutput,
  VoteInput,
  VoteOutput,
  CommentInput,
  CommentOutput,
  SubscribeInput,
  SubscribeOutput,
  SaveItemInput,
  SaveItemOutput,
  SubmitPostInput,
  SubmitPostOutput,
  SendMessageInput,
  SendMessageOutput,
  GetInboxInput,
  GetInboxOutput,
  EditPostInput,
  EditPostOutput,
  DeletePostInput,
  DeletePostOutput,
  EditCommentInput,
  EditCommentOutput,
  DeleteCommentInput,
  DeleteCommentOutput,
  HidePostInput,
  HidePostOutput,
  MarkReadInput,
  MarkReadOutput,
  DeleteMessageInput,
  DeleteMessageOutput,
  GetSavedInput,
  GetSavedOutput,
  GetUpvotedInput,
  GetUpvotedOutput,
  GetDownvotedInput,
  GetDownvotedOutput,
  GetHiddenInput,
  GetHiddenOutput,
  GetSubredditRulesInput,
  GetSubredditRulesOutput,
  GetPostFlairsInput,
  GetPostFlairsOutput,
  ReportInput,
  ReportOutput,
  BlockUserInput,
  BlockUserOutput,
  FollowUserInput,
  FollowUserOutput,
  ToggleInboxRepliesInput,
  ToggleInboxRepliesOutput,
  CrosspostInput,
  CrosspostOutput,
} from './schemas';

// ============================================================================
// Internal helpers
// ============================================================================

const BASE = 'https://www.reddit.com';

function getCsrfFromCookie(): string {
  const match = document.cookie
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('csrf_token='));
  if (!match) {
    throw new Unauthenticated(
      `CSRF token cookie not found. Make sure you are logged in. URL: ${window.location.href}`,
    );
  }
  return match.split('=')[1];
}

async function redditGet<T>(path: string): Promise<T> {
  const resp = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }
  return resp.json();
}

async function redditPost(
  path: string,
  body: Record<string, string>,
  modhash: string,
): Promise<Response> {
  const params = new URLSearchParams(body);
  params.set('uh', modhash);
  params.set('api_type', 'json');

  const resp = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Modhash': modhash,
    },
    body: params.toString(),
    credentials: 'include',
  });
  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }
  return resp;
}

interface RedditListing {
  kind: string;
  data: {
    after: string | null;
    children: Array<{ kind: string; data: Record<string, unknown> }>;
  };
}

function parsePost(d: Record<string, unknown>) {
  return {
    id: d.id as string,
    name: d.name as string,
    title: d.title as string,
    author: d.author as string,
    subreddit: d.subreddit as string,
    selftext: (d.selftext as string) || '',
    url: d.url as string,
    permalink: d.permalink as string,
    score: d.score as number,
    upvoteRatio: d.upvote_ratio as number,
    numComments: d.num_comments as number,
    createdUtc: d.created_utc as number,
    isSelf: d.is_self as boolean,
    over18: d.over_18 as boolean,
    stickied: d.stickied as boolean,
    locked: d.locked as boolean,
    saved: d.saved as boolean,
    likes: (d.likes as boolean | null) ?? null,
  };
}

function flattenComments(
  children: Array<{ kind: string; data: Record<string, unknown> }>,
  depth: number = 0,
): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = [];
  for (const child of children) {
    if (child.kind !== 't1') continue;
    const d = child.data;
    result.push({
      id: d.id,
      name: d.name,
      author: d.author || '[deleted]',
      body: (d.body as string) || '',
      score: d.score,
      createdUtc: d.created_utc,
      parentId: d.parent_id,
      depth,
      likes: d.likes ?? null,
      saved: d.saved || false,
      stickied: d.stickied || false,
    });
    const replies = d.replies as
      | {
          data?: {
            children?: Array<{ kind: string; data: Record<string, unknown> }>;
          };
        }
      | undefined;
    if (replies?.data?.children) {
      result.push(...flattenComments(replies.data.children, depth + 1));
    }
  }
  return result;
}

// ============================================================================
// Context
// ============================================================================

export async function getContext(): Promise<GetContextOutput> {
  const csrfToken = getCsrfFromCookie();

  const resp = await redditGet<{ data: Record<string, unknown> }>(
    '/api/me.json',
  );
  const data = resp.data;
  const modhash = data.modhash as string;
  const username = data.name as string;

  if (!modhash) {
    throw new Unauthenticated(
      'Could not extract modhash. Make sure you are logged in to Reddit.',
    );
  }
  if (!username) {
    throw new Unauthenticated(
      'Could not extract username. Make sure you are logged in to Reddit.',
    );
  }

  return { modhash, csrfToken, username };
}

// ============================================================================
// User
// ============================================================================

export async function getMe(_args: GetMeInput): Promise<GetMeOutput> {
  const resp = await redditGet<{ data: Record<string, unknown> }>(
    '/api/me.json',
  );
  const d = resp.data;
  return {
    name: d.name as string,
    id: d.subreddit ? `t2_${d.id}` : (d.id as string),
    totalKarma: (d.total_karma as number) || 0,
    linkKarma: (d.link_karma as number) || 0,
    commentKarma: (d.comment_karma as number) || 0,
    createdUtc: d.created_utc as number,
    hasVerifiedEmail: (d.has_verified_email as boolean) || false,
    isGold: (d.is_gold as boolean) || false,
    isMod: (d.is_mod as boolean) || false,
    iconUrl: (d.icon_img as string) || '',
  };
}

export async function getUserProfile(
  args: GetUserProfileInput,
): Promise<GetUserProfileOutput> {
  const resp = await redditGet<{ kind: string; data: Record<string, unknown> }>(
    `/user/${encodeURIComponent(args.username)}/about.json`,
  );
  const d = resp.data;
  const sub = d.subreddit as Record<string, unknown> | undefined;
  return {
    name: d.name as string,
    id: d.name ? `t2_${d.id}` : (d.id as string),
    totalKarma: (d.total_karma as number) || 0,
    linkKarma: (d.link_karma as number) || 0,
    commentKarma: (d.comment_karma as number) || 0,
    createdUtc: d.created_utc as number,
    subreddit: {
      displayName: (sub?.display_name as string) || '',
      title: (sub?.title as string) || '',
      publicDescription: (sub?.public_description as string) || '',
    },
    iconUrl: (d.icon_img as string) || (d.snoovatar_img as string) || '',
  };
}

// ============================================================================
// Feed & Posts
// ============================================================================

export async function getFeed(args: GetFeedInput): Promise<GetFeedOutput> {
  const params = new URLSearchParams();
  params.set('limit', String(args.limit || 25));
  if (args.after) params.set('after', args.after);
  if (args.t) params.set('t', args.t);

  const sort = args.sort || 'hot';
  const listing = await redditGet<RedditListing>(
    `/r/${encodeURIComponent(args.subreddit)}/${sort}.json?${params}`,
  );

  return {
    posts: listing.data.children
      .filter((c) => c.kind === 't3')
      .map((c) => parsePost(c.data)),
    after: listing.data.after,
  };
}

export async function getPost(args: GetPostInput): Promise<GetPostOutput> {
  const params = new URLSearchParams();
  params.set('sort', args.sort || 'best');
  params.set('limit', String(args.limit || 50));

  const resp = await redditGet<RedditListing[]>(
    `/r/${encodeURIComponent(args.subreddit)}/comments/${encodeURIComponent(args.postId)}.json?${params}`,
  );

  const postData = resp[0].data.children[0].data;
  const commentChildren = resp[1].data.children;

  return {
    post: parsePost(postData),
    comments: flattenComments(commentChildren) as GetPostOutput['comments'],
  };
}

// ============================================================================
// Search
// ============================================================================

export async function searchPosts(
  args: SearchPostsInput,
): Promise<SearchPostsOutput> {
  const params = new URLSearchParams();
  params.set('q', args.query);
  params.set('sort', args.sort || 'relevance');
  params.set('t', args.t || 'all');
  params.set('limit', String(args.limit || 25));
  params.set('type', 'link');
  if (args.after) params.set('after', args.after);
  if (args.subreddit) params.set('restrict_sr', 'true');

  const prefix = args.subreddit
    ? `/r/${encodeURIComponent(args.subreddit)}`
    : '';
  const listing = await redditGet<RedditListing>(
    `${prefix}/search.json?${params}`,
  );

  return {
    posts: listing.data.children
      .filter((c) => c.kind === 't3')
      .map((c) => parsePost(c.data)),
    after: listing.data.after,
  };
}

export async function searchSubreddits(
  args: SearchSubredditsInput,
): Promise<SearchSubredditsOutput> {
  const params = new URLSearchParams();
  params.set('q', args.query);
  params.set('limit', String(args.limit || 10));
  if (args.after) params.set('after', args.after);

  const listing = await redditGet<RedditListing>(
    `/subreddits/search.json?${params}`,
  );

  return {
    subreddits: listing.data.children
      .filter((c) => c.kind === 't5')
      .map((d) => {
        const data = d.data;
        return {
          name: data.display_name as string,
          fullname: data.name as string,
          title: (data.title as string) || '',
          publicDescription: (data.public_description as string) || '',
          subscribers: (data.subscribers as number) || 0,
          activeUserCount: (data.active_user_count as number) ?? null,
          over18: (data.over18 as boolean) || false,
          url: data.url as string,
        };
      }),
    after: listing.data.after,
  };
}

// ============================================================================
// Subreddit
// ============================================================================

export async function getSubreddit(
  args: GetSubredditInput,
): Promise<GetSubredditOutput> {
  const resp = await redditGet<{ kind: string; data: Record<string, unknown> }>(
    `/r/${encodeURIComponent(args.subreddit)}/about.json`,
  );
  const d = resp.data;
  return {
    name: d.display_name as string,
    fullname: d.name as string,
    title: (d.title as string) || '',
    publicDescription: (d.public_description as string) || '',
    description: (d.description as string) || '',
    subscribers: (d.subscribers as number) || 0,
    activeUserCount: (d.active_user_count as number) ?? null,
    createdUtc: d.created_utc as number,
    over18: (d.over18 as boolean) || false,
    url: d.url as string,
    bannerImg:
      (d.banner_background_image as string) || (d.banner_img as string) || '',
    iconImg: (d.community_icon as string) || (d.icon_img as string) || '',
    userIsSubscriber: (d.user_is_subscriber as boolean) ?? null,
    userIsModerator: (d.user_is_moderator as boolean) ?? null,
  };
}

// ============================================================================
// User Content
// ============================================================================

export async function getUserPosts(
  args: GetUserPostsInput,
): Promise<GetUserPostsOutput> {
  const params = new URLSearchParams();
  params.set('sort', args.sort || 'new');
  params.set('limit', String(args.limit || 25));
  if (args.t) params.set('t', args.t);
  if (args.after) params.set('after', args.after);

  const listing = await redditGet<RedditListing>(
    `/user/${encodeURIComponent(args.username)}/submitted.json?${params}`,
  );

  return {
    posts: listing.data.children
      .filter((c) => c.kind === 't3')
      .map((c) => parsePost(c.data)),
    after: listing.data.after,
  };
}

export async function getUserComments(
  args: GetUserCommentsInput,
): Promise<GetUserCommentsOutput> {
  const params = new URLSearchParams();
  params.set('sort', args.sort || 'new');
  params.set('limit', String(args.limit || 25));
  if (args.t) params.set('t', args.t);
  if (args.after) params.set('after', args.after);

  const listing = await redditGet<RedditListing>(
    `/user/${encodeURIComponent(args.username)}/comments.json?${params}`,
  );

  return {
    comments: listing.data.children
      .filter((c) => c.kind === 't1')
      .map((c) => {
        const d = c.data;
        return {
          id: d.id as string,
          name: d.name as string,
          author: d.author as string,
          body: (d.body as string) || '',
          score: d.score as number,
          createdUtc: d.created_utc as number,
          subreddit: d.subreddit as string,
          linkTitle: (d.link_title as string) || '',
          linkId: d.link_id as string,
          permalink: d.permalink as string,
        };
      }),
    after: listing.data.after,
  };
}

// ============================================================================
// Write Operations
// ============================================================================

export async function vote(args: VoteInput): Promise<VoteOutput> {
  const resp = await redditPost(
    '/api/vote',
    { id: args.id, dir: args.dir },
    args.modhash,
  );
  const text = await resp.text();
  // Vote returns empty body on success
  if (text && text !== '{}') {
    const json = JSON.parse(text);
    if (json.json?.errors?.length) {
      throw new UpstreamError(`Vote failed: ${JSON.stringify(json.json.errors)}`);
    }
  }
  return { success: true };
}

export async function comment(args: CommentInput): Promise<CommentOutput> {
  const resp = await redditPost(
    '/api/comment',
    { thing_id: args.parentId, text: args.text },
    args.modhash,
  );
  const json = await resp.json();
  if (json.json?.errors?.length) {
    throw new UpstreamError(`Comment failed: ${JSON.stringify(json.json.errors)}`);
  }
  const things = json.json?.data?.things;
  if (!things?.[0]) {
    throw new ContractDrift('Comment created but response missing data');
  }
  const d = things[0].data;
  return {
    id: (d.id as string) || (d.name as string),
    author: (d.author as string) || args.text.slice(0, 0), // author not in response
    body: (d.contentText as string) || (d.body as string) || args.text,
    createdUtc: (d.created_utc as number) || Math.floor(Date.now() / 1000),
  };
}

export async function subscribe(
  args: SubscribeInput,
): Promise<SubscribeOutput> {
  const body: Record<string, string> = { action: args.action };
  // Accept either fullname (t5_xxx) or display name
  if (args.subreddit.startsWith('t5_')) {
    body.sr = args.subreddit;
  } else {
    body.sr_name = args.subreddit;
  }
  const resp = await redditPost('/api/subscribe', body, args.modhash);
  const text = await resp.text();
  if (text && text !== '{}') {
    const json = JSON.parse(text);
    if (json.json?.errors?.length) {
      throw new UpstreamError(`Subscribe failed: ${JSON.stringify(json.json.errors)}`);
    }
  }
  return { success: true };
}

export async function saveItem(args: SaveItemInput): Promise<SaveItemOutput> {
  const endpoint = args.unsave ? '/api/unsave' : '/api/save';
  const resp = await redditPost(endpoint, { id: args.id }, args.modhash);
  const text = await resp.text();
  if (text && text !== '{}') {
    const json = JSON.parse(text);
    if (json.json?.errors?.length) {
      throw new UpstreamError(`Save failed: ${JSON.stringify(json.json.errors)}`);
    }
  }
  return { success: true };
}

export async function submitPost(
  args: SubmitPostInput,
): Promise<SubmitPostOutput> {
  const body: Record<string, string> = {
    sr: args.subreddit,
    title: args.title,
    kind: args.url ? 'link' : 'self',
  };
  if (args.url) {
    body.url = args.url;
  } else if (args.text) {
    body.text = args.text;
  }

  const resp = await redditPost('/api/submit', body, args.modhash);
  const json = await resp.json();
  if (json.json?.errors?.length) {
    throw new UpstreamError(`Submit failed: ${JSON.stringify(json.json.errors)}`);
  }
  const data = json.json?.data;
  return {
    id: data?.name || data?.id || '',
    url: data?.url || '',
  };
}

export async function sendMessage(
  args: SendMessageInput,
): Promise<SendMessageOutput> {
  const resp = await redditPost(
    '/api/compose',
    {
      to: args.to,
      subject: args.subject,
      text: args.body,
    },
    args.modhash,
  );
  const json = await resp.json();
  if (json.json?.errors?.length) {
    throw new UpstreamError(`Send message failed: ${JSON.stringify(json.json.errors)}`);
  }
  return { success: true };
}

export async function getInbox(args: GetInboxInput): Promise<GetInboxOutput> {
  const category = args.category || 'inbox';
  const params = new URLSearchParams();
  params.set('limit', String(args.limit || 25));
  if (args.after) params.set('after', args.after);

  const listing = await redditGet<RedditListing>(
    `/message/${category}.json?${params}`,
  );

  return {
    messages: listing.data.children.map((c) => {
      const d = c.data;
      return {
        id: d.name as string,
        author: (d.author as string) || '',
        subject: (d.subject as string) || '',
        body: (d.body as string) || '',
        createdUtc: d.created_utc as number,
        isNew: (d.new as boolean) || false,
        type: c.kind,
      };
    }),
    after: listing.data.after,
  };
}

// ============================================================================
// Edit & Delete
// ============================================================================

export async function editPost(args: EditPostInput): Promise<EditPostOutput> {
  const resp = await redditPost(
    '/api/editusertext',
    { thing_id: args.id, text: args.text },
    args.modhash,
  );
  const json = await resp.json();
  if (json.json?.errors?.length) {
    throw new UpstreamError(`Edit post failed: ${JSON.stringify(json.json.errors)}`);
  }
  const content = json.json?.data?.things?.[0]?.data;
  return {
    success: true,
    body:
      (content?.body as string) || (content?.selftext as string) || args.text,
  };
}

export async function deletePost(
  args: DeletePostInput,
): Promise<DeletePostOutput> {
  const resp = await redditPost('/api/del', { id: args.id }, args.modhash);
  const text = await resp.text();
  if (text && text !== '{}' && text !== '') {
    const json = JSON.parse(text);
    if (json.json?.errors?.length) {
      throw new UpstreamError(
        `Delete post failed: ${JSON.stringify(json.json.errors)}`,
      );
    }
  }
  return { success: true };
}

export async function editComment(
  args: EditCommentInput,
): Promise<EditCommentOutput> {
  const resp = await redditPost(
    '/api/editusertext',
    { thing_id: args.id, text: args.text },
    args.modhash,
  );
  const json = await resp.json();
  if (json.json?.errors?.length) {
    throw new UpstreamError(`Edit comment failed: ${JSON.stringify(json.json.errors)}`);
  }
  const content = json.json?.data?.things?.[0]?.data;
  return {
    success: true,
    body: (content?.body as string) || args.text,
  };
}

export async function deleteComment(
  args: DeleteCommentInput,
): Promise<DeleteCommentOutput> {
  const resp = await redditPost('/api/del', { id: args.id }, args.modhash);
  const text = await resp.text();
  if (text && text !== '{}' && text !== '') {
    const json = JSON.parse(text);
    if (json.json?.errors?.length) {
      throw new UpstreamError(
        `Delete comment failed: ${JSON.stringify(json.json.errors)}`,
      );
    }
  }
  return { success: true };
}

// ============================================================================
// Post Visibility
// ============================================================================

export async function hidePost(args: HidePostInput): Promise<HidePostOutput> {
  const endpoint = args.unhide ? '/api/unhide' : '/api/hide';
  const resp = await redditPost(endpoint, { id: args.id }, args.modhash);
  const text = await resp.text();
  if (text && text !== '{}' && text !== '') {
    const json = JSON.parse(text);
    if (json.json?.errors?.length) {
      throw new UpstreamError(`Hide post failed: ${JSON.stringify(json.json.errors)}`);
    }
  }
  return { success: true };
}

// ============================================================================
// Message Management
// ============================================================================

export async function markRead(args: MarkReadInput): Promise<MarkReadOutput> {
  const endpoint = args.unread ? '/api/unread_message' : '/api/read_message';
  const resp = await redditPost(
    endpoint,
    { id: args.ids.join(',') },
    args.modhash,
  );
  const text = await resp.text();
  if (text && text !== '{}' && text !== '') {
    const json = JSON.parse(text);
    if (json.json?.errors?.length) {
      throw new UpstreamError(`Mark read failed: ${JSON.stringify(json.json.errors)}`);
    }
  }
  return { success: true };
}

export async function deleteMessage(
  args: DeleteMessageInput,
): Promise<DeleteMessageOutput> {
  const resp = await redditPost('/api/del_msg', { id: args.id }, args.modhash);
  const text = await resp.text();
  if (text && text !== '{}' && text !== '') {
    const json = JSON.parse(text);
    if (json.json?.errors?.length) {
      throw new UpstreamError(
        `Delete message failed: ${JSON.stringify(json.json.errors)}`,
      );
    }
  }
  return { success: true };
}

// ============================================================================
// Engagement History
// ============================================================================

function parseEngagementItem(c: {
  kind: string;
  data: Record<string, unknown>;
}) {
  const d = c.data;
  return {
    kind: c.kind,
    id: d.name as string,
    title: (d.title as string) || (d.link_title as string) || '',
    body: (d.selftext as string) || (d.body as string) || '',
    author: (d.author as string) || '[deleted]',
    subreddit: (d.subreddit as string) || '',
    score: (d.score as number) || 0,
    createdUtc: d.created_utc as number,
    permalink: (d.permalink as string) || '',
  };
}

export async function getSaved(args: GetSavedInput): Promise<GetSavedOutput> {
  const params = new URLSearchParams();
  params.set('limit', String(args.limit || 25));
  if (args.after) params.set('after', args.after);

  const listing = await redditGet<RedditListing>(
    `/user/${encodeURIComponent(args.username)}/saved.json?${params}`,
  );

  return {
    items: listing.data.children.map(parseEngagementItem),
    after: listing.data.after,
  };
}

export async function getUpvoted(
  args: GetUpvotedInput,
): Promise<GetUpvotedOutput> {
  const params = new URLSearchParams();
  params.set('limit', String(args.limit || 25));
  if (args.after) params.set('after', args.after);

  const listing = await redditGet<RedditListing>(
    `/user/${encodeURIComponent(args.username)}/upvoted.json?${params}`,
  );

  return {
    items: listing.data.children.map(parseEngagementItem),
    after: listing.data.after,
  };
}

export async function getDownvoted(
  args: GetDownvotedInput,
): Promise<GetDownvotedOutput> {
  const params = new URLSearchParams();
  params.set('limit', String(args.limit || 25));
  if (args.after) params.set('after', args.after);

  const listing = await redditGet<RedditListing>(
    `/user/${encodeURIComponent(args.username)}/downvoted.json?${params}`,
  );

  return {
    items: listing.data.children.map(parseEngagementItem),
    after: listing.data.after,
  };
}

export async function getHidden(
  args: GetHiddenInput,
): Promise<GetHiddenOutput> {
  const params = new URLSearchParams();
  params.set('limit', String(args.limit || 25));
  if (args.after) params.set('after', args.after);

  const listing = await redditGet<RedditListing>(
    `/user/${encodeURIComponent(args.username)}/hidden.json?${params}`,
  );

  return {
    posts: listing.data.children
      .filter((c) => c.kind === 't3')
      .map((c) => parsePost(c.data)),
    after: listing.data.after,
  };
}

// ============================================================================
// Subreddit Details
// ============================================================================

export async function getSubredditRules(
  args: GetSubredditRulesInput,
): Promise<GetSubredditRulesOutput> {
  const data = await redditGet<{
    rules: Array<Record<string, unknown>>;
    site_rules: string[];
  }>(`/r/${encodeURIComponent(args.subreddit)}/about/rules.json`);

  return {
    rules: (data.rules || []).map((r) => ({
      shortName: (r.short_name as string) || '',
      description: (r.description as string) || '',
      kind: (r.kind as string) || 'all',
      priority: (r.priority as number) || 0,
    })),
    siteRules: data.site_rules || [],
  };
}

export async function getPostFlairs(
  args: GetPostFlairsInput,
): Promise<GetPostFlairsOutput> {
  const data = await redditGet<Array<Record<string, unknown>>>(
    `/r/${encodeURIComponent(args.subreddit)}/api/link_flair_v2.json`,
  );

  return {
    flairs: (data || []).map((f) => ({
      id: (f.id as string) || '',
      text: (f.text as string) || '',
      textEditable: (f.text_editable as boolean) || false,
      backgroundColor: (f.background_color as string) || '',
      textColor: (f.text_color as string) || 'dark',
    })),
  };
}

// ============================================================================
// User Engagement
// ============================================================================

export async function report(args: ReportInput): Promise<ReportOutput> {
  const resp = await redditPost(
    '/api/report',
    { thing_id: args.id, reason: args.reason, other_reason: args.reason },
    args.modhash,
  );
  const text = await resp.text();
  if (text && text !== '{}' && text !== '') {
    const json = JSON.parse(text);
    if (json.json?.errors?.length) {
      throw new UpstreamError(`Report failed: ${JSON.stringify(json.json.errors)}`);
    }
  }
  return { success: true };
}

export async function blockUser(
  args: BlockUserInput,
): Promise<BlockUserOutput> {
  const resp = await redditPost(
    '/api/block_user',
    { name: args.username },
    args.modhash,
  );
  const text = await resp.text();
  if (text && text !== '{}' && text !== '') {
    const json = JSON.parse(text);
    if (json.json?.errors?.length || json.errors?.length) {
      throw new UpstreamError(
        `Block user failed: ${JSON.stringify(json.json?.errors || json.errors)}`,
      );
    }
  }
  return { success: true };
}

export async function followUser(
  args: FollowUserInput,
): Promise<FollowUserOutput> {
  if (args.unfollow) {
    const resp = await redditPost(
      '/api/unfriend',
      { name: args.username, type: 'friend', container: '' },
      args.modhash,
    );
    const text = await resp.text();
    if (text && text !== '{}' && text !== '') {
      const json = JSON.parse(text);
      if (json.json?.errors?.length) {
        throw new UpstreamError(`Unfollow failed: ${JSON.stringify(json.json.errors)}`);
      }
    }
  } else {
    const resp = await redditPost(
      '/api/friend',
      { name: args.username, type: 'friend', container: '' },
      args.modhash,
    );
    const text = await resp.text();
    if (text && text !== '{}' && text !== '') {
      const json = JSON.parse(text);
      if (json.json?.errors?.length) {
        throw new UpstreamError(`Follow failed: ${JSON.stringify(json.json.errors)}`);
      }
    }
  }
  return { success: true };
}

export async function toggleInboxReplies(
  args: ToggleInboxRepliesInput,
): Promise<ToggleInboxRepliesOutput> {
  const resp = await redditPost(
    '/api/sendreplies',
    { id: args.id, state: String(args.state) },
    args.modhash,
  );
  const text = await resp.text();
  if (text && text !== '{}' && text !== '') {
    const json = JSON.parse(text);
    if (json.json?.errors?.length) {
      throw new UpstreamError(
        `Toggle replies failed: ${JSON.stringify(json.json.errors)}`,
      );
    }
  }
  return { success: true };
}

export async function crosspost(
  args: CrosspostInput,
): Promise<CrosspostOutput> {
  const body: Record<string, string> = {
    sr: args.subreddit,
    title: args.title,
    kind: 'crosspost',
    crosspost_fullname: args.originalPostId,
  };

  const resp = await redditPost('/api/submit', body, args.modhash);
  const json = await resp.json();
  if (json.json?.errors?.length) {
    throw new UpstreamError(`Crosspost failed: ${JSON.stringify(json.json.errors)}`);
  }
  const data = json.json?.data;
  return {
    id: data?.name || data?.id || '',
    url: data?.url || '',
  };
}
