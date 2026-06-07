/**
 * LinkedIn Post Interaction Operations
 *
 * Like, unlike, comment, delete comments, view reactions, and view activity.
 */

import type {
  LikePostOutput,
  UnlikePostOutput,
  CreateCommentOutput,
  EditCommentOutput,
  DeleteCommentOutput,
  GetPostsOutput,
  GetHomeFeedOutput,
  GetPostReactionsOutput,
  GetCommentReactionsOutput,
  GetPostCommentsOutput,
  LikeCommentOutput,
  UnlikeCommentOutput,
  GetProfileCommentsOutput,
  GetProfileReactionsOutput,
  Post,
  Reactor,
  Comment,
  CreatePostOutput,
  DeletePostOutput,
  EditPostOutput,
  RepostPostOutput,
  UndoRepostOutput,
  SchedulePostOutput,
  ListScheduledPostsOutput,
  ScheduledPost,
  EditScheduledPostOutput,
  ReschedulePostOutput,
} from '../schemas';
import {
  linkedinFetch,
  encodeVars,
  getQueryId,
  buildEntityMap,
  getActivityQueryId,
} from '../helpers';
import { Validation, ContractDrift, NotFound, UpstreamError, throwForStatus } from '@vallum/_runtime';

const MIN_EPOCH_MS = 1_000_000_000_000; // Sep 2001; anything below is likely seconds
const MIN_SCHEDULE_LEAD_MS = 10 * 60 * 1000; // 10 minutes

function validateScheduledAt(scheduledAt: number): void {
  if (scheduledAt < MIN_EPOCH_MS) {
    throw new Validation(
      `scheduledAt (${scheduledAt}) looks like epoch seconds, not milliseconds. ` +
        `Multiply by 1000 or use Date.getTime() which returns ms. ` +
        `Expected a 13-digit number like ${Date.now()}.`,
    );
  }
  const now = Date.now();
  if (scheduledAt <= now) {
    throw new Validation(
      `scheduledAt (${scheduledAt}) is in the past. ` +
        `Now is ${now} (${new Date(now).toISOString()}). ` +
        `scheduledAt resolves to ${new Date(scheduledAt).toISOString()}.`,
    );
  }
  if (scheduledAt - now < MIN_SCHEDULE_LEAD_MS) {
    throw new Validation(
      `scheduledAt is only ${Math.round((scheduledAt - now) / 60000)} minutes in the future. ` +
        `LinkedIn requires at least ~20 minutes lead time. ` +
        `Current time: ${new Date(now).toLocaleString()}, ` +
        `Scheduled: ${new Date(scheduledAt).toLocaleString()}.`,
    );
  }
}

/**
 * Extract paging info from a GraphQL feed response.
 * The response key varies based on the dynamically discovered queryId
 * (e.g., feedDashProfileUpdatesByDocumentUpdateType vs feedDashProfileUpdatesByMemberShareFeed).
 * This finds whichever feed key exists and reads paging from it.
 */
type FeedValue = {
  paging?: { total?: number };
  metadata?: { paginationToken?: string };
  '*elements'?: string[];
};

function extractFeedPaging(data: { data?: Record<string, unknown> }): {
  total?: number;
  paginationToken?: string;
  elements?: string[];
} {
  const inner = data?.data;
  if (!inner) return {};

  const extract = (val: FeedValue) => ({
    total: val.paging!.total,
    paginationToken: val.metadata?.paginationToken,
    elements: val['*elements'],
  });

  for (const key of Object.keys(inner)) {
    if (key.startsWith('$')) continue;
    const val = inner[key] as FeedValue | null;
    if (val?.paging) return extract(val);
    // Handle nested data.data.{feedKey} structure
    if (typeof val === 'object' && val !== null) {
      for (const subKey of Object.keys(val as Record<string, unknown>)) {
        if (subKey.startsWith('$')) continue;
        const subVal = (val as Record<string, unknown>)[
          subKey
        ] as FeedValue | null;
        if (subVal?.paging) return extract(subVal);
      }
    }
  }
  return {};
}

/**
 * Extract image and video URLs from a post's content field.
 *
 * Company posts: content IS the component (ImageComponent, LinkedInVideoComponent).
 * Home feed: content wraps components (content.imageComponent, content.linkedInVideoComponent).
 * - Images: images[0].attributes[0].vectorImage (rootUrl + artifacts)
 * - Videos: ['*videoPlayMetadata'] is a reference to a VideoPlayMetadata entity
 *   in the included array, resolved via entityMap.
 */
function extractMediaUrls(
  content: Record<string, unknown> | undefined,
  entityMap: Record<string, unknown>,
): {
  imageUrl?: string;
  videoUrl?: string;
} {
  if (!content) return {};

  let imageUrl: string | undefined;
  let videoUrl: string | undefined;

  // Resolve the image source: direct (company posts) or nested (home feed)
  type VectorImage = {
    rootUrl?: string;
    artifacts?: Array<{
      width?: number;
      height?: number;
      fileIdentifyingUrlPathSegment?: string;
    }>;
  };
  const imageSource = (content.images ??
    (content.imageComponent as Record<string, unknown> | undefined)?.images) as
    | Array<{
        attributes?: Array<{
          vectorImage?: VectorImage;
          detailData?: {
            '*imageUrl'?: string;
            imageUrl?: string;
            vectorImage?: VectorImage;
          };
        }>;
      }>
    | undefined;

  if (imageSource?.[0]?.attributes?.[0]) {
    const attr = imageSource[0].attributes[0];
    // Company posts: vectorImage directly on attribute
    // Home feed: vectorImage nested in detailData
    const vi = attr.vectorImage ?? attr.detailData?.vectorImage;
    if (vi?.rootUrl && vi.artifacts?.length) {
      const artifacts = vi.artifacts;
      const largest = artifacts[artifacts.length - 1];
      if (largest.fileIdentifyingUrlPathSegment) {
        imageUrl = vi.rootUrl + largest.fileIdentifyingUrlPathSegment;
      }
    }
    if (!imageUrl && attr.detailData) {
      imageUrl = attr.detailData.imageUrl || attr.detailData['*imageUrl'];
    }
  }

  // Resolve the video source: direct (company posts) or nested (home feed)
  const videoMetaRef = (content['*videoPlayMetadata'] ??
    (content.linkedInVideoComponent as Record<string, unknown> | undefined)?.[
      '*videoPlayMetadata'
    ]) as string | undefined;
  if (videoMetaRef) {
    const videoMeta = entityMap[videoMetaRef] as
      | {
          progressiveStreams?: Array<{
            streamingLocations?: Array<{ url?: string }>;
            width?: number;
          }>;
        }
      | undefined;
    if (videoMeta?.progressiveStreams?.length) {
      const streams = videoMeta.progressiveStreams;
      const largest = streams.reduce((a, b) =>
        (b.width ?? 0) > (a.width ?? 0) ? b : a,
      );
      videoUrl = largest.streamingLocations?.[0]?.url;
    }
  }

  return { imageUrl, videoUrl };
}

/**
 * Encode a URN string for LinkedIn API paths.
 */
function encodeUrn(urn: string): string {
  return encodeURIComponent(urn).replace(/\(/g, '%28').replace(/\)/g, '%29');
}

/**
 * Convert fsd_comment URN to the urn:li:comment:() format used by the reaction API.
 * Input:  urn:li:fsd_comment:(COMMENT_ID,urn:li:activity:ACTIVITY_ID)
 *    or:  urn:li:fsd_normComment:(COMMENT_ID,urn:li:activity:ACTIVITY_ID)
 * Output: urn:li:comment:(activity:ACTIVITY_ID,COMMENT_ID)
 *
 * The reaction API (create/delete-social-dash-reactions) requires this format as threadUrn.
 * Using fsd_comment URNs directly returns 400 "Couldn't react to this post."
 */
function fsdCommentToCommentUrn(commentUrn: string): string {
  // Match both fsd_comment and fsd_normComment formats
  const match = commentUrn.match(
    /urn:li:fsd_(?:norm)?[Cc]omment:\((\d+),urn:li:activity:(\d+)\)/,
  );
  if (match) {
    return `urn:li:comment:(activity:${match[2]},${match[1]})`;
  }
  // If already in urn:li:comment format, return as-is
  if (commentUrn.startsWith('urn:li:comment:')) {
    return commentUrn;
  }
  // Fallback: return as-is and let the API error with a meaningful message
  return commentUrn;
}

export async function likePost(opts: {
  csrf: string;
  postUrn: string;
  reactionType?:
    | 'LIKE'
    | 'PRAISE'
    | 'EMPATHY'
    | 'INTEREST'
    | 'APPRECIATION'
    | 'ENTERTAINMENT';
  companyId?: string;
}): Promise<LikePostOutput> {
  const queryId = getQueryId(
    'voyagerSocialDashReactions',
    'create-social-dash-reactions',
  );

  const reactionType = opts.reactionType ? opts.reactionType : 'LIKE';

  const entity: Record<string, string> = { reactionType };
  if (opts.companyId) {
    entity.actorUrn = `urn:li:fsd_company:${opts.companyId}`;
  }

  await linkedinFetch(
    opts.csrf,
    `/voyager/api/graphql?action=execute&queryId=${queryId}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        variables: {
          entity,
          threadUrn: opts.postUrn,
        },
        queryId,
      }),
    },
  );

  return { success: true };
}

export async function unlikePost(opts: {
  csrf: string;
  postUrn: string;
  companyId?: string;
}): Promise<UnlikePostOutput> {
  const queryId = getQueryId(
    'voyagerSocialDashReactions',
    'delete-social-dash-reactions',
  );

  const variables: Record<string, string> = {
    threadUrn: opts.postUrn,
  };
  if (opts.companyId) {
    variables.nonMemberActorUrn = `urn:li:fsd_company:${opts.companyId}`;
  }

  await linkedinFetch(
    opts.csrf,
    `/voyager/api/graphql?action=execute&queryId=${queryId}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        variables,
        queryId,
        includeWebMetadata: true,
      }),
    },
  );

  return { success: true };
}

export async function createComment(opts: {
  csrf: string;
  postUrn: string;
  text: string;
  parentCommentUrn?: string;
  companyId?: string;
}): Promise<CreateCommentOutput> {
  interface CommentResponse {
    data?: {
      entityUrn?: string;
    };
  }

  // For replies, the threadUrn must be the parent comment's socialDetail threadUrn
  // format: urn:li:comment:(activity:ACTIVITY_ID,COMMENT_ID)
  let threadUrn = opts.postUrn;
  if (opts.parentCommentUrn) {
    threadUrn = fsdCommentToCommentUrn(opts.parentCommentUrn);
  }

  const body: Record<string, unknown> = {
    commentary: {
      text: opts.text,
      attributesV2: [],
      $type: 'com.linkedin.voyager.dash.common.text.TextViewModel',
    },
    threadUrn,
  };

  if (opts.companyId) {
    body.nonMemberActorUrn = `urn:li:fsd_company:${opts.companyId}`;
  }

  const resp = await linkedinFetch<CommentResponse>(
    opts.csrf,
    '/voyager/api/voyagerSocialDashNormComments?decorationId=com.linkedin.voyager.dash.deco.social.NormComment-43',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );

  // Return the fsd_comment URN
  let commentUrn = resp.data?.entityUrn;
  if (commentUrn?.includes('fsd_normComment:')) {
    commentUrn = commentUrn.replace('urn:li:fsd_normComment:', '');
  }

  return {
    success: true,
    commentUrn,
  };
}

export async function deleteComment(opts: {
  csrf: string;
  commentUrn: string;
}): Promise<DeleteCommentOutput> {
  // Strip fsd_normComment wrapper if present; API expects fsd_comment URN
  let urn = opts.commentUrn;
  if (urn.includes('fsd_normComment:')) {
    urn = urn.replace('urn:li:fsd_normComment:', '');
  }
  const encodedUrn = encodeUrn(urn);

  await linkedinFetch(
    opts.csrf,
    `/voyager/api/voyagerSocialDashNormComments/${encodedUrn}`,
    {
      method: 'DELETE',
    },
  );

  return { success: true };
}

export async function editComment(opts: {
  csrf: string;
  commentUrn: string;
  newText: string;
}): Promise<EditCommentOutput> {
  // Strip fsd_normComment wrapper if present
  let urn = opts.commentUrn;
  if (urn.includes('fsd_normComment:')) {
    urn = urn.replace('urn:li:fsd_normComment:', '');
  }
  const encodedUrn = encodeUrn(urn);

  await linkedinFetch(
    opts.csrf,
    `/voyager/api/voyagerSocialDashNormComments/${encodedUrn}?decorationId=com.linkedin.voyager.dash.deco.social.NormComment-43`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patch: {
          $set: {
            commentary: {
              text: opts.newText,
              attributesV2: [],
              $type: 'com.linkedin.voyager.dash.common.text.TextViewModel',
            },
          },
        },
      }),
    },
  );

  return { success: true };
}

export async function getPosts(opts: {
  csrf: string;
  memberId: string;
  count?: number;
  start?: number;
}): Promise<GetPostsOutput> {
  const count = opts.count !== undefined ? opts.count : 20;
  const start = opts.start !== undefined ? opts.start : 0;

  // Resolve vanity name to member ID if needed
  let memberId = opts.memberId;
  if (!opts.memberId.startsWith('ACo')) {
    const { resolveVanityNameToMemberId } = await import('../helpers/index.js');
    const resolved = await resolveVanityNameToMemberId(
      opts.csrf,
      opts.memberId,
    );
    if (!resolved) {
      throw new NotFound(`Could not resolve vanity name: ${opts.memberId}`);
    }
    memberId = resolved;
  }

  const profileUrn = `urn:li:fsd_profile:${memberId}`;
  const queryId = getActivityQueryId('posts');

  // Auto-paginate using paginationToken (start param is ignored by LinkedIn's API)
  const allPosts: Post[] = [];
  let profileInfo: { memberId: string; fullName?: string } | undefined;
  let paginationToken: string | undefined;
  let lastTotal: number | undefined;
  const needed = start + count;

  while (allPosts.length < needed) {
    const vars: Record<string, unknown> = {
      count: needed,
      start: 0,
      profileUrn,
    };
    if (paginationToken) {
      vars.paginationToken = paginationToken;
    }
    const variables = encodeVars(vars);

    const resp = await linkedinFetch<{
      data?: { data?: Record<string, unknown> };
      included?: unknown[];
    }>(
      opts.csrf,
      `/voyager/api/graphql?includeWebMetadata=true&variables=${variables}&queryId=${queryId}`,
    );

    const entityMap = buildEntityMap(resp.included);
    const pagePosts: Post[] = [];

    // Extract profile info first (profile entity may appear after updates in included array)
    if (!profileInfo && resp.included) {
      for (const entity of resp.included) {
        const pe = entity as {
          entityUrn?: string;
          firstName?: string;
          lastName?: string;
        };
        if (
          pe.entityUrn === `urn:li:fsd_profile:${memberId}` &&
          (pe.firstName || pe.lastName)
        ) {
          profileInfo = {
            memberId,
            fullName: [pe.firstName, pe.lastName].filter(Boolean).join(' '),
          };
          break;
        }
      }
    }

    if (resp.included) {
      for (const entity of resp.included) {
        const e = entity as {
          entityUrn?: string;
          $type?: string;
          commentary?: { text?: string | { text?: string } };
          createdAt?: number;
          '*actor'?: string;
          actor?: {
            name?: { text?: string };
            description?: { text?: string };
            subDescription?: { text?: string };
            backendUrn?: string;
            navigationContext?: { actionTarget?: string };
          };
          '*socialDetail'?: string;
          '*resharedUpdate'?: string;
          content?: Record<string, unknown>;
          header?: { text?: { text?: string } };
          firstName?: string;
          lastName?: string;
        };

        // Process update entities
        if (e.entityUrn?.includes('fsd_update:')) {
          // Extract the activity URN from the update URN
          const activityMatch = e.entityUrn.match(/urn:li:activity:(\d+)/);
          const activityUrn = activityMatch
            ? `urn:li:activity:${activityMatch[1]}`
            : undefined;

          // Extract thread URN from socialDetail reference (used by reactions API)
          let ugcPostUrn: string | undefined;
          if (e['*socialDetail']) {
            const sdMatch = (e['*socialDetail'] as string).match(
              /fsd_socialDetail:\((urn:li:(?:ugcPost|activity):\d+)/,
            );
            if (sdMatch) {
              ugcPostUrn = sdMatch[1];
            }
          }

          // Get social counts; SocialDetail uses *totalSocialActivityCounts reference
          let likesCount: number | undefined;
          let commentsCount: number | undefined;
          let repostsCount: number | undefined;

          if (e['*socialDetail']) {
            const socialDetail = entityMap[e['*socialDetail']] as
              | {
                  '*totalSocialActivityCounts'?: string;
                }
              | undefined;

            if (socialDetail?.['*totalSocialActivityCounts']) {
              const counts = entityMap[
                socialDetail['*totalSocialActivityCounts']
              ] as
                | {
                    numLikes?: number;
                    numComments?: number;
                    numShares?: number;
                  }
                | undefined;

              if (counts) {
                likesCount = counts.numLikes;
                commentsCount = counts.numComments;
                repostsCount = counts.numShares;
              }
            }
          }

          // Get author info
          let authorName: string | undefined;
          let authorHeadline: string | undefined;
          let authorMemberId: string | undefined;
          let authorVanityName: string | undefined;
          let relativeTime: string | undefined;

          if (e.actor) {
            authorName = e.actor.name?.text;
            authorHeadline = e.actor.description?.text;
            if (e.actor.backendUrn) {
              const memberMatch =
                e.actor.backendUrn.match(/urn:li:member:(\d+)/);
              if (memberMatch) {
                authorMemberId = memberMatch[1];
              }
            }
            if (e.actor.navigationContext?.actionTarget) {
              const vanityMatch =
                e.actor.navigationContext.actionTarget.match(/\/in\/([^/?]+)/);
              authorVanityName = vanityMatch?.[1];
            }
            // Extract relative time from actor.subDescription
            if (e.actor.subDescription?.text) {
              const timeText = e.actor.subDescription.text.trim();
              const timeMatch = timeText.match(/^(\d+\w+)/);
              if (timeMatch) {
                relativeTime = timeMatch[1];
              }
            }
          } else if (e['*actor']) {
            const actor = entityMap[e['*actor']] as
              | {
                  name?: { text?: string };
                  description?: { text?: string };
                  subDescription?: { text?: string };
                  '*urn'?: string;
                  navigationUrl?: string;
                }
              | undefined;

            if (actor) {
              authorName = actor.name?.text;
              authorHeadline = actor.description?.text;
              if (actor['*urn']) {
                const urnEntity = entityMap[actor['*urn']] as
                  | {
                      entityUrn?: string;
                    }
                  | undefined;
                authorMemberId = urnEntity?.entityUrn?.split(':').pop();
              }
              if (actor.navigationUrl) {
                const vanityMatch = actor.navigationUrl.match(/\/in\/([^/?]+)/);
                authorVanityName = vanityMatch?.[1];
              }
              // Extract relative time from resolved actor.subDescription
              if (actor.subDescription?.text) {
                const timeText = actor.subDescription.text.trim();
                const timeMatch = timeText.match(/^(\d+\w+)/);
                if (timeMatch) {
                  relativeTime = timeMatch[1];
                }
              }
            }
          }

          // Extract text - can be string or nested object with text property
          let postText: string | undefined;
          if (e.commentary?.text) {
            if (typeof e.commentary.text === 'string') {
              postText = e.commentary.text;
            } else if (
              typeof e.commentary.text === 'object' &&
              e.commentary.text.text
            ) {
              postText = e.commentary.text.text;
            }
          }

          // Detect media content and extract URLs
          const { imageUrl, videoUrl } = extractMediaUrls(
            e.content as Record<string, unknown> | undefined,
            entityMap,
          );
          const hasImage = !!imageUrl;
          const hasVideo = !!videoUrl;

          // Detect post type using two reliable signals (order matters):
          // 1. Author mismatch: on profile activity, instant reposts show the
          //    ORIGINAL author (not the profile owner) as the actor. Check FIRST
          //    because an instant-repost of a repost-with-commentary will have
          //    *resharedUpdate from the inner post but the author won't match.
          // 2. *resharedUpdate reference: reposts-with-commentary by the profile
          //    owner have this field pointing to the original post.
          let postType: 'original' | 'repost' | 'repost_with_commentary' =
            'original';
          let originalPostUrn: string | undefined;

          if (
            profileInfo?.fullName &&
            authorName &&
            authorName !== profileInfo.fullName
          ) {
            // Instant repost; actor is the original author, not the profile owner
            postType = 'repost';
            // The activityUrn on these entities is the original post's activity
            originalPostUrn = activityUrn;
          } else if (e['*resharedUpdate']) {
            // Repost with commentary; profile owner added text above the original
            postType = 'repost_with_commentary';
            const origMatch = (e['*resharedUpdate'] as string).match(
              /urn:li:activity:(\d+)/,
            );
            if (origMatch) {
              originalPostUrn = `urn:li:activity:${origMatch[1]}`;
            }
          }

          const isRepost = postType !== 'original';

          // Normalize authorMemberId to ACo format when possible
          if (authorMemberId && /^\d+$/.test(authorMemberId)) {
            for (const [key, val] of Object.entries(entityMap)) {
              if (!key.startsWith('urn:li:fsd_profile:')) continue;
              const profile = val as { backendUrn?: string };
              if (profile.backendUrn === `urn:li:member:${authorMemberId}`) {
                authorMemberId = key.split(':').pop()!;
                break;
              }
            }
          }

          pagePosts.push({
            postUrn: e.entityUrn,
            activityUrn,
            ugcPostUrn,
            text: postText,
            timestamp: e.createdAt,
            relativeTime,
            likesCount,
            commentsCount,
            repostsCount,
            authorName,
            authorHeadline,
            authorMemberId,
            authorVanityName,
            authorProfileUrl: authorVanityName
              ? `https://www.linkedin.com/in/${authorVanityName}`
              : authorMemberId
                ? `https://www.linkedin.com/in/${authorMemberId}`
                : undefined,
            postType,
            isRepost,
            originalPostUrn,
            hasImage,
            hasVideo,
            imageUrl,
            videoUrl,
            postUrl: activityUrn
              ? `https://www.linkedin.com/feed/update/${activityUrn}`
              : undefined,
          });
        }
      }
    }

    // Sort by feed element order (included array is unordered)
    const paging = extractFeedPaging(resp);
    if (paging.elements) {
      pagePosts.sort((a, b) => {
        const idxA = a.postUrn ? paging.elements!.indexOf(a.postUrn) : -1;
        const idxB = b.postUrn ? paging.elements!.indexOf(b.postUrn) : -1;
        return (
          (idxA === -1 ? Infinity : idxA) - (idxB === -1 ? Infinity : idxB)
        );
      });
    }

    allPosts.push(...pagePosts);

    lastTotal = paging.total ?? lastTotal;
    paginationToken = paging.paginationToken;

    if (!paginationToken) break;
    if (pagePosts.length === 0) break;
  }

  const posts = allPosts.slice(start, start + count);
  // LinkedIn always returns paginationToken and total:0; both are unreliable.
  // Use result count: if we got as many as requested, there's likely more.
  const hasMore = posts.length >= count;

  return {
    posts,
    hasMore,
    profileInfo,
  };
}

export async function getHomeFeed(opts: {
  csrf: string;
  count?: number;
  start?: number;
}): Promise<GetHomeFeedOutput> {
  const count = opts.count !== undefined ? opts.count : 20;
  const start = opts.start !== undefined ? opts.start : 0;

  const queryId = getQueryId('voyagerFeedDashMainFeed', 'relevance-feed');

  // Auto-paginate: sponsored posts get filtered out so we may need multiple
  // requests to fill the requested count. Fetch start+count organic posts
  // from the beginning, then slice; same pattern as getPosts.
  const allPosts: Post[] = [];
  const seenActivityUrns = new Set<string>();
  let apiStart = 0;
  let lastTotal: number | undefined;
  let lastPaginationToken: string | undefined;
  const needed = start + count;

  while (allPosts.length < needed) {
    // Request more than needed since sponsored posts are filtered out
    const requestCount = Math.max(needed - allPosts.length, 10) + 10;

    const variables = encodeVars({
      count: requestCount,
      start: apiStart,
      feedType: 'MAIN_FEED_RELEVANCE',
    });

    const resp = await linkedinFetch<{
      data?: { data?: Record<string, unknown> };
      included?: unknown[];
    }>(
      opts.csrf,
      `/voyager/api/graphql?includeWebMetadata=true&variables=${variables}&queryId=${queryId}`,
    );

    const entityMap = buildEntityMap(resp.included);
    const pagePosts: Post[] = [];

    if (resp.included) {
      for (const entity of resp.included) {
        const e = entity as {
          entityUrn?: string;
          $type?: string;
          commentary?: { text?: string | { text?: string } };
          createdAt?: number;
          '*actor'?: string;
          actor?: {
            name?: { text?: string };
            description?: { text?: string };
            subDescription?: { text?: string };
            backendUrn?: string;
            navigationContext?: { actionTarget?: string };
          };
          '*socialDetail'?: string;
          content?: Record<string, unknown>;
          resharedUpdate?: unknown;
          '*resharedUpdate'?: string;
        };

        // Process update entities; skip sponsored content
        if (
          e.entityUrn?.includes('fsd_update:') &&
          !e.entityUrn.includes('sponsoredContentV2') &&
          (e.commentary ||
            e.content ||
            e.resharedUpdate ||
            e['*resharedUpdate'])
        ) {
          // Extract the activity URN from the update URN
          const activityMatch = e.entityUrn.match(/urn:li:activity:(\d+)/);
          const activityUrn = activityMatch
            ? `urn:li:activity:${activityMatch[1]}`
            : undefined;

          // Skip non-post updates (hidePostAction, updateActions, etc.)
          if (!activityUrn) continue;

          // Dedup across pages
          if (seenActivityUrns.has(activityUrn)) continue;
          seenActivityUrns.add(activityUrn);

          // Extract thread URN from socialDetail reference
          let ugcPostUrn: string | undefined;
          if (e['*socialDetail']) {
            const sdMatch = (e['*socialDetail'] as string).match(
              /fsd_socialDetail:\((urn:li:(?:ugcPost|activity):\d+)/,
            );
            if (sdMatch) {
              ugcPostUrn = sdMatch[1];
            }
          }

          // Get social counts
          let likesCount: number | undefined;
          let commentsCount: number | undefined;
          let repostsCount: number | undefined;

          if (e['*socialDetail']) {
            const socialDetail = entityMap[e['*socialDetail']] as
              | { '*totalSocialActivityCounts'?: string }
              | undefined;

            if (socialDetail?.['*totalSocialActivityCounts']) {
              const counts = entityMap[
                socialDetail['*totalSocialActivityCounts']
              ] as
                | {
                    numLikes?: number;
                    numComments?: number;
                    numShares?: number;
                  }
                | undefined;

              if (counts) {
                likesCount = counts.numLikes;
                commentsCount = counts.numComments;
                repostsCount = counts.numShares;
              }
            }
          }

          // Get author info; home feed uses inline actor objects
          let authorName: string | undefined;
          let authorHeadline: string | undefined;
          let authorMemberId: string | undefined;
          let authorVanityName: string | undefined;
          let relativeTime: string | undefined;

          if (e.actor) {
            authorName = e.actor.name?.text;
            authorHeadline = e.actor.description?.text;
            if (e.actor.backendUrn) {
              const memberMatch =
                e.actor.backendUrn.match(/urn:li:member:(\d+)/);
              if (memberMatch) {
                authorMemberId = memberMatch[1];
              }
            }
            if (e.actor.navigationContext?.actionTarget) {
              const vanityMatch =
                e.actor.navigationContext.actionTarget.match(/\/in\/([^/?]+)/);
              authorVanityName = vanityMatch?.[1];
              // Also try to extract memberId from miniProfileUrn in URL
              if (!authorMemberId) {
                const profileMatch =
                  e.actor.navigationContext.actionTarget.match(
                    /miniProfileUrn=.*?fsd_profile(?:%3A|:)(ACo[A-Za-z0-9_-]+)/,
                  );
                if (profileMatch) {
                  authorMemberId = profileMatch[1];
                }
              }
            }
            if (e.actor.subDescription?.text) {
              const timeText = e.actor.subDescription.text.trim();
              const timeMatch = timeText.match(/^(\d+\w+)/);
              if (timeMatch) {
                relativeTime = timeMatch[1];
              }
            }
          } else if (e['*actor']) {
            const actor = entityMap[e['*actor']] as
              | {
                  name?: { text?: string };
                  description?: { text?: string };
                  subDescription?: { text?: string };
                  '*urn'?: string;
                  navigationUrl?: string;
                }
              | undefined;

            if (actor) {
              authorName = actor.name?.text;
              authorHeadline = actor.description?.text;
              if (actor['*urn']) {
                const urnEntity = entityMap[actor['*urn']] as
                  | { entityUrn?: string }
                  | undefined;
                authorMemberId = urnEntity?.entityUrn?.split(':').pop();
              }
              if (actor.navigationUrl) {
                const vanityMatch = actor.navigationUrl.match(/\/in\/([^/?]+)/);
                authorVanityName = vanityMatch?.[1];
              }
              if (actor.subDescription?.text) {
                const timeText = actor.subDescription.text.trim();
                const timeMatch = timeText.match(/^(\d+\w+)/);
                if (timeMatch) {
                  relativeTime = timeMatch[1];
                }
              }
            }
          }

          // Extract text
          let postText: string | undefined;
          if (e.commentary?.text) {
            if (typeof e.commentary.text === 'string') {
              postText = e.commentary.text;
            } else if (
              typeof e.commentary.text === 'object' &&
              e.commentary.text.text
            ) {
              postText = e.commentary.text.text;
            }
          }

          // Detect media content and extract URLs
          const { imageUrl, videoUrl } = extractMediaUrls(
            e.content as Record<string, unknown> | undefined,
            entityMap,
          );
          const hasImage = !!imageUrl;
          const hasVideo = !!videoUrl;

          // Detect post type using two signals:
          // 1. *resharedUpdate reference: reposts-with-commentary have this field
          // 2. RESHARED in entityUrn tuple or resharedUpdate (without *): instant reposts
          let postType: 'original' | 'repost' | 'repost_with_commentary' =
            'original';
          let originalPostUrn: string | undefined;

          if (e['*resharedUpdate']) {
            postType = 'repost_with_commentary';
            const origMatch = (e['*resharedUpdate'] as string).match(
              /urn:li:activity:(\d+)/,
            );
            if (origMatch) {
              originalPostUrn = `urn:li:activity:${origMatch[1]}`;
            }
          } else if (e.entityUrn?.includes(',RESHARED,') || e.resharedUpdate) {
            postType = 'repost';
          }

          const isRepost = postType !== 'original';

          // Normalize authorMemberId to ACo format when possible
          if (authorMemberId && /^\d+$/.test(authorMemberId)) {
            for (const [key, val] of Object.entries(entityMap)) {
              if (!key.startsWith('urn:li:fsd_profile:')) continue;
              const profile = val as { backendUrn?: string };
              if (profile.backendUrn === `urn:li:member:${authorMemberId}`) {
                authorMemberId = key.split(':').pop()!;
                break;
              }
            }
          }

          pagePosts.push({
            postUrn: e.entityUrn,
            activityUrn,
            ugcPostUrn,
            text: postText,
            timestamp: e.createdAt,
            relativeTime,
            likesCount,
            commentsCount,
            repostsCount,
            authorName,
            authorHeadline,
            authorMemberId,
            authorVanityName,
            authorProfileUrl: authorVanityName
              ? `https://www.linkedin.com/in/${authorVanityName}`
              : authorMemberId
                ? `https://www.linkedin.com/in/${authorMemberId}`
                : undefined,
            postType,
            isRepost,
            originalPostUrn,
            hasImage,
            hasVideo,
            imageUrl,
            videoUrl,
            postUrl: activityUrn
              ? `https://www.linkedin.com/feed/update/${activityUrn}`
              : undefined,
          });
        }
      }
    }

    // Sort by feed element order (included array is unordered)
    const paging = extractFeedPaging(resp);
    if (paging.elements) {
      pagePosts.sort((a, b) => {
        const idxA = a.postUrn ? paging.elements!.indexOf(a.postUrn) : -1;
        const idxB = b.postUrn ? paging.elements!.indexOf(b.postUrn) : -1;
        return (
          (idxA === -1 ? Infinity : idxA) - (idxB === -1 ? Infinity : idxB)
        );
      });
    }

    allPosts.push(...pagePosts);
    lastTotal = paging.total ?? lastTotal;
    lastPaginationToken = paging.paginationToken;

    // Advance offset for next page
    apiStart += requestCount;

    // Stop if no more posts or we've hit the end
    if (pagePosts.length === 0) break;
    if (lastTotal != null && apiStart >= lastTotal) break;
    if (!lastPaginationToken && pagePosts.length < requestCount) break;
  }

  const posts = allPosts.slice(start, start + count);
  // LinkedIn always returns paginationToken and total:0; both are unreliable.
  const hasMore = allPosts.length > start + count || posts.length >= count;

  return {
    posts,
    hasMore,
  };
}

export async function getPostReactions(opts: {
  csrf: string;
  postUrn: string;
  reactionType?:
    | 'LIKE'
    | 'PRAISE'
    | 'EMPATHY'
    | 'INTEREST'
    | 'APPRECIATION'
    | 'ENTERTAINMENT';
  count?: number;
  start?: number;
}): Promise<GetPostReactionsOutput> {
  const count = opts.count !== undefined ? opts.count : 10;
  const start = opts.start !== undefined ? opts.start : 0;

  const queryId = getQueryId('voyagerSocialDashReactions', 'reactions-by-type');

  // Normalize URN format - can be activity or ugcPost
  let threadUrn = opts.postUrn;
  if (threadUrn.includes('fsd_update:')) {
    const activityMatch = threadUrn.match(/urn:li:activity:(\d+)/);
    if (activityMatch) {
      threadUrn = `urn:li:activity:${activityMatch[1]}`;
    }
  }

  interface ReactionsResponse {
    data?: {
      data?: {
        socialDashReactionsByReactionType?: {
          paging?: { total?: number };
          '*elements'?: string[];
          elements?: unknown[];
        };
      };
    };
    included?: unknown[];
  }

  function parseReactionsResponse(resp: ReactionsResponse): {
    reactions: Reactor[];
    total?: number;
    hasMore: boolean;
  } {
    const reactions: Reactor[] = [];
    const entityMap = buildEntityMap(resp.included);

    if (resp.included) {
      for (const entity of resp.included) {
        const e = entity as {
          entityUrn?: string;
          $type?: string;
          reactionType?: string;
          reactorLockup?: {
            title?: { text?: string };
            subtitle?: { text?: string };
            navigationUrl?: string;
          };
          '*reactor'?: string;
        };

        if (e.$type?.includes('Reaction') && e.reactorLockup) {
          const lockup = e.reactorLockup;
          const fullName = lockup.title?.text;
          const headline = lockup.subtitle?.text;

          let vanityName: string | undefined;
          let memberId: string | undefined;
          if (lockup.navigationUrl) {
            const vanityMatch = lockup.navigationUrl.match(/\/in\/([^/?]+)/);
            if (vanityMatch) {
              vanityName = vanityMatch[1];
              if (vanityName.startsWith('ACo')) {
                memberId = vanityName;
                vanityName = undefined;
              }
            }
          }

          if (!memberId && e['*reactor']) {
            const reactorEntity = entityMap[e['*reactor']] as
              | { entityUrn?: string }
              | undefined;
            if (reactorEntity?.entityUrn) {
              memberId = reactorEntity.entityUrn.split(':').pop();
            }
          }

          if (!fullName) continue;
          if (memberId && reactions.some((r) => r.memberId === memberId))
            continue;
          if (!memberId && reactions.some((r) => r.fullName === fullName))
            continue;

          // Split fullName into firstName/lastName
          const nameParts = fullName.split(' ');
          const firstName = nameParts[0];
          const lastName =
            nameParts.length > 1 ? nameParts.slice(1).join(' ') : undefined;

          reactions.push({
            memberId,
            firstName,
            lastName,
            fullName,
            headline,
            vanityName,
            profileUrl: vanityName
              ? `https://www.linkedin.com/in/${vanityName}`
              : memberId
                ? `https://www.linkedin.com/in/${memberId}`
                : undefined,
            reactionType: e.reactionType as Reactor['reactionType'],
          });
        }
      }
    }

    const reactionData = resp.data?.data?.socialDashReactionsByReactionType;
    const total = reactionData?.paging?.total;
    const hasMore =
      total !== undefined ? start + reactions.length < total : false;

    return { reactions, total, hasMore };
  }

  function buildVars(urn: string): string {
    const obj: Record<string, unknown> = { count, start, threadUrn: urn };
    if (opts.reactionType) obj.reactionType = opts.reactionType;
    return encodeVars(obj);
  }

  const resp = await linkedinFetch<ReactionsResponse>(
    opts.csrf,
    `/voyager/api/graphql?includeWebMetadata=true&variables=${buildVars(threadUrn)}&queryId=${queryId}`,
  );

  let result = parseReactionsResponse(resp);

  // Activity URNs often return empty; discover ugcPost URN from network traffic and retry
  if (
    result.reactions.length === 0 &&
    threadUrn.startsWith('urn:li:activity:')
  ) {
    const activityId = threadUrn.split(':').pop()!;
    let ugcPostUrn: string | undefined;

    for (const entry of performance.getEntriesByType('resource')) {
      if (!entry.name.includes(activityId)) continue;
      const ugcMatch = entry.name.match(/ugcPost(?:%3A|:)(\d+)/);
      if (ugcMatch) {
        ugcPostUrn = `urn:li:ugcPost:${ugcMatch[1]}`;
        break;
      }
    }

    if (ugcPostUrn) {
      const retryResp = await linkedinFetch<ReactionsResponse>(
        opts.csrf,
        `/voyager/api/graphql?includeWebMetadata=true&variables=${buildVars(ugcPostUrn)}&queryId=${queryId}`,
      );
      result = parseReactionsResponse(retryResp);
    }
  }

  return result;
}

export async function getCommentReactions(opts: {
  csrf: string;
  commentUrn: string;
  reactionType?:
    | 'LIKE'
    | 'PRAISE'
    | 'EMPATHY'
    | 'INTEREST'
    | 'APPRECIATION'
    | 'ENTERTAINMENT';
  count?: number;
  start?: number;
}): Promise<GetCommentReactionsOutput> {
  const count = opts.count !== undefined ? opts.count : 10;
  const start = opts.start !== undefined ? opts.start : 0;

  const queryId = getQueryId('voyagerSocialDashReactions', 'reactions-by-type');

  // Convert fsd_comment URN to urn:li:comment:() format
  const threadUrn = fsdCommentToCommentUrn(opts.commentUrn);

  interface ReactionsResponse {
    data?: {
      data?: {
        socialDashReactionsByReactionType?: {
          paging?: { total?: number };
          '*elements'?: string[];
          elements?: unknown[];
        };
      };
    };
    included?: unknown[];
  }

  const variables: Record<string, unknown> = { count, start, threadUrn };
  if (opts.reactionType) variables.reactionType = opts.reactionType;

  const resp = await linkedinFetch<ReactionsResponse>(
    opts.csrf,
    `/voyager/api/graphql?includeWebMetadata=true&variables=${encodeVars(variables)}&queryId=${queryId}`,
  );

  const reactions: Reactor[] = [];
  const entityMap = buildEntityMap(resp.included);

  if (resp.included) {
    for (const entity of resp.included) {
      const e = entity as {
        entityUrn?: string;
        $type?: string;
        reactionType?: string;
        reactorLockup?: {
          title?: { text?: string };
          subtitle?: { text?: string };
          navigationUrl?: string;
        };
        '*reactor'?: string;
      };

      if (e.$type?.includes('Reaction') && e.reactorLockup) {
        const lockup = e.reactorLockup;
        const fullName = lockup.title?.text;
        const headline = lockup.subtitle?.text;

        let vanityName: string | undefined;
        let memberId: string | undefined;
        if (lockup.navigationUrl) {
          const vanityMatch = lockup.navigationUrl.match(/\/in\/([^/?]+)/);
          if (vanityMatch) {
            vanityName = vanityMatch[1];
            if (vanityName.startsWith('ACo')) {
              memberId = vanityName;
              vanityName = undefined;
            }
          }
        }

        if (!memberId && e['*reactor']) {
          const reactorEntity = entityMap[e['*reactor']] as
            | { entityUrn?: string }
            | undefined;
          if (reactorEntity?.entityUrn) {
            memberId = reactorEntity.entityUrn.split(':').pop();
          }
        }

        if (!fullName) continue;
        if (memberId && reactions.some((r) => r.memberId === memberId))
          continue;
        if (!memberId && reactions.some((r) => r.fullName === fullName))
          continue;

        const nameParts = fullName.split(' ');
        const firstName = nameParts[0];
        const lastName =
          nameParts.length > 1 ? nameParts.slice(1).join(' ') : undefined;

        reactions.push({
          memberId,
          firstName,
          lastName,
          fullName,
          headline,
          vanityName,
          profileUrl: vanityName
            ? `https://www.linkedin.com/in/${vanityName}`
            : memberId
              ? `https://www.linkedin.com/in/${memberId}`
              : undefined,
          reactionType: e.reactionType as Reactor['reactionType'],
        });
      }
    }
  }

  const reactionData = resp.data?.data?.socialDashReactionsByReactionType;
  const total = reactionData?.paging?.total;
  const hasMore =
    total !== undefined ? start + reactions.length < total : false;

  return { reactions, total, hasMore };
}

export async function getPostComments(opts: {
  csrf: string;
  postUrn: string;
  count?: number;
  start?: number;
  sortOrder?: 'RELEVANCE' | 'RECENCY';
  includeReplies?: boolean;
}): Promise<GetPostCommentsOutput> {
  const count = opts.count !== undefined ? opts.count : 10;
  const start = opts.start !== undefined ? opts.start : 0;
  const sortOrder = opts.sortOrder !== undefined ? opts.sortOrder : 'RELEVANCE';
  const numReplies = opts.includeReplies === false ? 0 : 1;

  const queryId = getQueryId(
    'voyagerSocialDashComments',
    'comments-by-social-detail',
  );

  // Normalize URN format - construct socialDetailUrn
  let activityUrn = opts.postUrn;
  if (activityUrn.includes('fsd_update:')) {
    const activityMatch = activityUrn.match(/urn:li:activity:(\d+)/);
    if (activityMatch) {
      activityUrn = `urn:li:activity:${activityMatch[1]}`;
    }
  }
  if (activityUrn.includes('ugcPost:')) {
    // ugcPost format stays as-is
  }

  // LinkedIn uses a triple-URN socialDetailUrn format
  const socialDetailUrn = `urn:li:fsd_socialDetail:(${activityUrn},${activityUrn},urn:li:highlightedReply:-)`;

  // LinkedIn API uses REVERSE_CHRONOLOGICAL, not RECENCY
  const apiSortOrder =
    sortOrder === 'RECENCY' ? 'REVERSE_CHRONOLOGICAL' : sortOrder;

  const variables = encodeVars({
    count,
    start,
    numReplies,
    socialDetailUrn,
    sortOrder: apiSortOrder,
  });

  interface CommentsResponse {
    data?: {
      data?: {
        socialDashCommentsBySocialDetail?: {
          paging?: { total?: number };
          metadata?: { paginationToken?: string };
        };
      };
    };
    included?: unknown[];
  }

  const resp = await linkedinFetch<CommentsResponse>(
    opts.csrf,
    `/voyager/api/graphql?includeWebMetadata=true&variables=${variables}&queryId=${queryId}`,
  );

  const comments: Comment[] = [];
  const entityMap = buildEntityMap(resp.included);

  if (resp.included) {
    // First pass: collect comment entities (exclude hideCommentAction entities)
    const commentEntities: Array<{
      urn: string;
      entity: Record<string, unknown>;
    }> = [];

    for (const entity of resp.included) {
      const e = entity as {
        entityUrn?: string;
        $type?: string;
        commentary?: { text?: string };
        createdAt?: number;
        commenter?: {
          title?: { text?: string };
          subtitle?: string;
          navigationUrl?: string;
          urn?: string;
          actorUnion?: { profileUrn?: string; companyUrn?: string };
        };
        '*commenter'?: string;
        numReplies?: number;
        '*firstReply'?: string;
        socialActivityCountsInsight?: { numLikes?: number };
      };

      // Only match actual comment entities, not hideCommentAction
      if (e.entityUrn?.startsWith('urn:li:fsd_comment:')) {
        commentEntities.push({
          urn: e.entityUrn,
          entity: e as Record<string, unknown>,
        });
      }
    }

    // Helper: extract commenter info from inline commenter or referenced entity
    function extractCommenterInfo(e: {
      commenter?: {
        title?: { text?: string };
        subtitle?: string;
        navigationUrl?: string;
        urn?: string;
        commenterProfileId?: string;
        actorUnion?: { profileUrn?: string; companyUrn?: string };
        actor?: { '*profileUrn'?: string };
      };
      '*commenter'?: string;
    }): {
      commenterMemberId?: string;
      commenterName?: string;
      commenterHeadline?: string;
      commenterVanityName?: string;
      commenterProfileUrl?: string;
    } {
      let commenterMemberId: string | undefined;
      let commenterName: string | undefined;
      let commenterHeadline: string | undefined;
      let commenterVanityName: string | undefined;

      if (e.commenter) {
        commenterName = e.commenter.title?.text;
        commenterHeadline = e.commenter.subtitle;

        if (e.commenter.navigationUrl) {
          const vanityMatch = e.commenter.navigationUrl.match(/\/in\/([^/?]+)/);
          if (vanityMatch) {
            const vanity = vanityMatch[1];
            if (vanity.startsWith('ACo')) {
              commenterMemberId = vanity;
            } else {
              commenterVanityName = vanity;
            }
          }
        }

        if (!commenterMemberId && e.commenter.commenterProfileId) {
          commenterMemberId = e.commenter.commenterProfileId;
        }
        if (!commenterMemberId && e.commenter.actorUnion?.profileUrn) {
          commenterMemberId = e.commenter.actorUnion.profileUrn
            .split(':')
            .pop();
        }
        if (!commenterMemberId && e.commenter.actor?.['*profileUrn']) {
          const profileEntity = entityMap[e.commenter.actor['*profileUrn']] as
            | { entityUrn?: string }
            | undefined;
          commenterMemberId = profileEntity?.entityUrn?.split(':').pop();
        }
        if (!commenterMemberId && e.commenter.urn) {
          commenterMemberId = e.commenter.urn.split(':').pop();
        }
      }

      if (!commenterName && e['*commenter']) {
        const commenter = entityMap[e['*commenter']] as
          | {
              firstName?: string;
              lastName?: string;
              headline?: string;
              publicIdentifier?: string;
              entityUrn?: string;
            }
          | undefined;

        if (commenter) {
          commenterMemberId = commenter.entityUrn?.split(':').pop();
          commenterName =
            [commenter.firstName, commenter.lastName]
              .filter(Boolean)
              .join(' ') || undefined;
          commenterHeadline = commenter.headline;
          commenterVanityName = commenter.publicIdentifier;
        }
      }

      return {
        commenterMemberId,
        commenterName,
        commenterHeadline,
        commenterVanityName,
        commenterProfileUrl: commenterVanityName
          ? `https://www.linkedin.com/in/${commenterVanityName}`
          : commenterMemberId
            ? `https://www.linkedin.com/in/${commenterMemberId}`
            : undefined,
      };
    }

    // Helper: get likes count via SocialDetail → SocialActivityCounts → reactionTypeCounts
    function getCommentLikesCount(
      socialDetailRef: string | undefined,
    ): number | undefined {
      if (!socialDetailRef) return undefined;
      const sd = entityMap[socialDetailRef] as
        | { '*totalSocialActivityCounts'?: string }
        | undefined;
      if (!sd?.['*totalSocialActivityCounts']) return undefined;
      const counts = entityMap[sd['*totalSocialActivityCounts']] as
        | { reactionTypeCounts?: Array<{ count?: number }> }
        | undefined;
      if (!counts?.reactionTypeCounts?.length) return undefined;
      return counts.reactionTypeCounts.reduce(
        (sum, r) => sum + (r.count ?? 0),
        0,
      );
    }

    // Helper: get replies via SocialDetail → comments.*elements
    function getCommentReplies(socialDetailRef: string | undefined): {
      repliesCount?: number;
      replies: Comment[];
    } {
      if (!socialDetailRef) return { replies: [] };
      const sd = entityMap[socialDetailRef] as
        | {
            comments?: {
              metadata?: { updatedCommentCount?: number };
              '*elements'?: string[];
            };
          }
        | undefined;
      if (!sd?.comments) return { replies: [] };

      const repliesCount = sd.comments.metadata?.updatedCommentCount ?? 0;
      const replies: Comment[] = [];
      const replyUrns = sd.comments['*elements'];
      if (replyUrns) {
        for (const replyUrn of replyUrns) {
          const replyEntity = entityMap[replyUrn] as
            | {
                entityUrn?: string;
                commentary?: { text?: string };
                createdAt?: number;
                commenter?: {
                  title?: { text?: string };
                  subtitle?: string;
                  navigationUrl?: string;
                  urn?: string;
                  commenterProfileId?: string;
                  actorUnion?: { profileUrn?: string };
                  actor?: { '*profileUrn'?: string };
                };
                '*commenter'?: string;
                '*socialDetail'?: string;
              }
            | undefined;

          if (!replyEntity) continue;

          const replyCommenter = extractCommenterInfo(replyEntity);
          const replyLikes = getCommentLikesCount(replyEntity['*socialDetail']);

          replies.push({
            commentUrn: replyEntity.entityUrn,
            text: replyEntity.commentary?.text,
            createdAt: replyEntity.createdAt,
            commenterMemberId: replyCommenter.commenterMemberId,
            commenterName: replyCommenter.commenterName,
            commenterHeadline: replyCommenter.commenterHeadline,
            commenterVanityName: replyCommenter.commenterVanityName,
            commenterProfileUrl: replyCommenter.commenterProfileUrl,
            likesCount: replyLikes ?? 0,
          });
        }
      }

      return { repliesCount, replies };
    }

    // Second pass: build comment objects
    for (const { urn, entity } of commentEntities) {
      const e = entity as {
        entityUrn?: string;
        commentary?: { text?: string };
        createdAt?: number;
        commenter?: {
          title?: { text?: string };
          subtitle?: string;
          navigationUrl?: string;
          urn?: string;
          commenterProfileId?: string;
          actorUnion?: { profileUrn?: string; companyUrn?: string };
          actor?: { '*profileUrn'?: string };
        };
        '*commenter'?: string;
        '*socialDetail'?: string;
      };

      const commenterInfo = extractCommenterInfo(e);
      const likesCount = getCommentLikesCount(e['*socialDetail']);
      const { repliesCount, replies } =
        numReplies > 0
          ? getCommentReplies(e['*socialDetail'])
          : { repliesCount: undefined, replies: [] as Comment[] };

      comments.push({
        commentUrn: urn,
        text: e.commentary?.text,
        createdAt: e.createdAt,
        commenterMemberId: commenterInfo.commenterMemberId,
        commenterName: commenterInfo.commenterName,
        commenterHeadline: commenterInfo.commenterHeadline,
        commenterVanityName: commenterInfo.commenterVanityName,
        commenterProfileUrl: commenterInfo.commenterProfileUrl,
        likesCount: likesCount ?? 0,
        repliesCount: numReplies > 0 ? repliesCount : undefined,
        replies: numReplies > 0 && replies.length > 0 ? replies : undefined,
      });
    }
  }

  // Filter out replies that already appear nested under a parent comment
  const replyUrns = new Set<string>();
  for (const c of comments) {
    if (c.replies) {
      for (const r of c.replies) {
        const reply = r as Comment;
        if (reply.commentUrn) replyUrns.add(reply.commentUrn);
      }
    }
  }
  const topLevelComments =
    replyUrns.size > 0
      ? comments.filter((c) => !c.commentUrn || !replyUrns.has(c.commentUrn))
      : comments;

  // Enforce count limit; API may return more entities in included array
  const slicedComments = topLevelComments.slice(0, count);

  // Get pagination info
  const commentData = resp.data?.data?.socialDashCommentsBySocialDetail;
  const total = commentData?.paging?.total;
  const hasMore =
    total !== undefined
      ? start + slicedComments.length < total
      : comments.length > count;

  return {
    comments: slicedComments,
    total,
    hasMore,
  };
}

export async function likeComment(opts: {
  csrf: string;
  commentUrn: string;
}): Promise<LikeCommentOutput> {
  const queryId = getQueryId(
    'voyagerSocialDashReactions',
    'create-social-dash-reactions',
  );

  // Convert fsd_comment URN to the urn:li:comment:() format required by the reaction API.
  // Input:  urn:li:fsd_comment:(COMMENT_ID,urn:li:activity:ACTIVITY_ID)
  // Needed: urn:li:comment:(activity:ACTIVITY_ID,COMMENT_ID)
  const threadUrn = fsdCommentToCommentUrn(opts.commentUrn);

  await linkedinFetch(
    opts.csrf,
    `/voyager/api/graphql?action=execute&queryId=${queryId}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        variables: {
          entity: { reactionType: 'LIKE' },
          threadUrn,
        },
        queryId,
      }),
    },
  );

  return { success: true };
}

export async function unlikeComment(opts: {
  csrf: string;
  commentUrn: string;
}): Promise<UnlikeCommentOutput> {
  const queryId = getQueryId(
    'voyagerSocialDashReactions',
    'delete-social-dash-reactions',
  );

  const threadUrn = fsdCommentToCommentUrn(opts.commentUrn);

  await linkedinFetch(
    opts.csrf,
    `/voyager/api/graphql?action=execute&queryId=${queryId}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        variables: {
          threadUrn,
        },
        queryId,
        includeWebMetadata: true,
      }),
    },
  );

  return { success: true };
}

export async function getProfileComments(opts: {
  csrf: string;
  memberId: string;
  count?: number;
  start?: number;
}): Promise<GetProfileCommentsOutput> {
  const count = opts.count !== undefined ? opts.count : 20;
  const start = opts.start !== undefined ? opts.start : 0;

  // Resolve vanity name to member ID if needed
  let memberId = opts.memberId;
  if (!opts.memberId.startsWith('ACo')) {
    const { resolveVanityNameToMemberId } = await import('../helpers/index.js');
    const resolved = await resolveVanityNameToMemberId(
      opts.csrf,
      opts.memberId,
    );
    if (!resolved) {
      throw new NotFound(`Could not resolve vanity name: ${opts.memberId}`);
    }
    memberId = resolved;
  }

  const profileUrn = `urn:li:fsd_profile:${memberId}`;
  const queryId = getActivityQueryId('comments');

  // Auto-paginate using paginationToken (start param is ignored by LinkedIn's API)
  const allComments: GetProfileCommentsOutput['comments'] = [];
  let paginationToken: string | undefined;
  let lastTotal: number | undefined;
  const needed = start + count;

  while (allComments.length < needed) {
    const vars: Record<string, unknown> = {
      count: needed,
      start: 0,
      profileUrn,
    };
    if (paginationToken) {
      vars.paginationToken = paginationToken;
    }
    const variables = encodeVars(vars);

    const resp = await linkedinFetch<{
      data?: { data?: Record<string, unknown> };
      included?: unknown[];
    }>(
      opts.csrf,
      `/voyager/api/graphql?includeWebMetadata=true&variables=${variables}&queryId=${queryId}`,
    );

    const entityMap = buildEntityMap(resp.included);
    const pageComments: GetProfileCommentsOutput['comments'] = [];

    if (resp.included) {
      for (const entity of resp.included) {
        const e = entity as {
          entityUrn?: string;
          $type?: string;
          commentary?: { text?: string | { text?: string } };
          createdAt?: number;
          '*actor'?: string;
          actor?: {
            name?: { text?: string };
            description?: { text?: string };
            backendUrn?: string;
            navigationContext?: { actionTarget?: string };
          };
          '*highlightedComments'?: string[];
        };

        // Process update entities with PROFILE_COMMENTS flag
        if (
          e.entityUrn?.includes('fsd_update:') &&
          e.entityUrn?.includes('PROFILE_COMMENTS')
        ) {
          // Get post author info; may be inline actor or *actor reference
          let postAuthorName: string | undefined;
          let postAuthorMemberId: string | undefined;
          let postAuthorVanityName: string | undefined;

          if (e.actor) {
            postAuthorName = e.actor.name?.text;
            if (e.actor.backendUrn) {
              const memberMatch =
                e.actor.backendUrn.match(/urn:li:member:(\d+)/);
              if (memberMatch) {
                postAuthorMemberId = memberMatch[1];
              }
            }
            if (e.actor.navigationContext?.actionTarget) {
              const vanityMatch =
                e.actor.navigationContext.actionTarget.match(/\/in\/([^/?]+)/);
              postAuthorVanityName = vanityMatch?.[1];
            }
          } else if (e['*actor']) {
            const actor = entityMap[e['*actor']] as
              | {
                  name?: { text?: string };
                  '*urn'?: string;
                  navigationUrl?: string;
                }
              | undefined;

            if (actor) {
              postAuthorName = actor.name?.text;
              if (actor['*urn']) {
                const urnEntity = entityMap[actor['*urn']] as
                  | { entityUrn?: string }
                  | undefined;
                postAuthorMemberId = urnEntity?.entityUrn?.split(':').pop();
              }
              if (actor.navigationUrl) {
                const vanityMatch = actor.navigationUrl.match(/\/in\/([^/?]+)/);
                postAuthorVanityName = vanityMatch?.[1];
              }
            }
          }

          // Extract post text
          let postText: string | undefined;
          if (e.commentary?.text) {
            if (typeof e.commentary.text === 'string') {
              postText = e.commentary.text;
            } else if (
              typeof e.commentary.text === 'object' &&
              e.commentary.text.text
            ) {
              postText = e.commentary.text.text;
            }
          }

          // Extract activity URN
          const activityMatch = e.entityUrn?.match(/urn:li:activity:(\d+)/);
          const postActivityUrn = activityMatch
            ? `urn:li:activity:${activityMatch[1]}`
            : undefined;

          // Process highlighted comments
          if (e['*highlightedComments']) {
            for (const commentUrn of e['*highlightedComments']) {
              const comment = entityMap[commentUrn] as
                | {
                    entityUrn?: string;
                    commentary?: { text?: string };
                    createdAt?: number;
                    commenter?: {
                      title?: { text?: string };
                      subtitle?: string;
                      navigationUrl?: string;
                      commenterProfileId?: string;
                    };
                    '*commenter'?: string;
                  }
                | undefined;

              if (!comment) continue;

              let commenterName: string | undefined;
              let commenterHeadline: string | undefined;
              let commenterMemberId: string | undefined;
              let commenterVanityName: string | undefined;

              if (comment.commenter) {
                commenterName = comment.commenter.title?.text;
                commenterHeadline = comment.commenter.subtitle;
                commenterMemberId = comment.commenter.commenterProfileId;

                if (comment.commenter.navigationUrl) {
                  const vanityMatch =
                    comment.commenter.navigationUrl.match(/\/in\/([^/?]+)/);
                  if (vanityMatch) {
                    const vanity = vanityMatch[1];
                    if (vanity.startsWith('ACo')) {
                      commenterMemberId = vanity;
                    } else {
                      commenterVanityName = vanity;
                    }
                  }
                }
              }

              pageComments.push({
                commentText: comment.commentary?.text,
                commentedAt: comment.createdAt,
                commenterName,
                commenterHeadline,
                commenterMemberId,
                commenterVanityName,
                commenterProfileUrl: commenterVanityName
                  ? `https://www.linkedin.com/in/${commenterVanityName}`
                  : commenterMemberId
                    ? `https://www.linkedin.com/in/${commenterMemberId}`
                    : undefined,
                postText,
                postAuthorName,
                postAuthorMemberId,
                postAuthorVanityName,
                postAuthorProfileUrl: postAuthorVanityName
                  ? `https://www.linkedin.com/in/${postAuthorVanityName}`
                  : postAuthorMemberId
                    ? `https://www.linkedin.com/in/${postAuthorMemberId}`
                    : undefined,
                postActivityUrn,
              });
            }
          }
        }
      }
    }

    // Sort by feed element order (included array is unordered)
    const paging = extractFeedPaging(resp);
    if (paging.elements) {
      pageComments.sort((a, b) => {
        const idxA = a.postActivityUrn
          ? paging.elements!.findIndex((el) => el.includes(a.postActivityUrn!))
          : -1;
        const idxB = b.postActivityUrn
          ? paging.elements!.findIndex((el) => el.includes(b.postActivityUrn!))
          : -1;
        return (
          (idxA === -1 ? Infinity : idxA) - (idxB === -1 ? Infinity : idxB)
        );
      });
    }

    allComments.push(...pageComments);

    lastTotal = paging.total ?? lastTotal;
    paginationToken = paging.paginationToken;

    if (!paginationToken) break;
    if (pageComments.length === 0) break;
  }

  const comments = allComments.slice(start, start + count);
  const total =
    lastTotal !== undefined && lastTotal > 0 ? lastTotal : undefined;
  // LinkedIn always returns paginationToken and total:0; both are unreliable.
  const hasMore = comments.length >= count;

  return {
    comments,
    total,
    hasMore,
  };
}

export async function getProfileReactions(opts: {
  csrf: string;
  memberId: string;
  count?: number;
  start?: number;
}): Promise<GetProfileReactionsOutput> {
  const count = opts.count !== undefined ? opts.count : 20;
  const start = opts.start !== undefined ? opts.start : 0;

  // Resolve vanity name to member ID if needed
  let memberId = opts.memberId;
  if (!opts.memberId.startsWith('ACo')) {
    const { resolveVanityNameToMemberId } = await import('../helpers/index.js');
    const resolved = await resolveVanityNameToMemberId(
      opts.csrf,
      opts.memberId,
    );
    if (!resolved) {
      throw new NotFound(`Could not resolve vanity name: ${opts.memberId}`);
    }
    memberId = resolved;
  }

  const profileUrn = `urn:li:fsd_profile:${memberId}`;
  const queryId = getActivityQueryId('reactions');

  // Auto-paginate using paginationToken (start param is ignored by LinkedIn's API)
  const allPosts: Post[] = [];
  let paginationToken: string | undefined;
  let lastTotal: number | undefined;
  const needed = start + count;

  while (allPosts.length < needed) {
    const vars: Record<string, unknown> = {
      count: needed,
      start: 0,
      profileUrn,
    };
    if (paginationToken) {
      vars.paginationToken = paginationToken;
    }
    const variables = encodeVars(vars);

    const resp = await linkedinFetch<{
      data?: { data?: Record<string, unknown> };
      included?: unknown[];
    }>(
      opts.csrf,
      `/voyager/api/graphql?includeWebMetadata=true&variables=${variables}&queryId=${queryId}`,
    );

    const entityMap = buildEntityMap(resp.included);
    const pagePosts: Post[] = [];

    if (resp.included) {
      for (const entity of resp.included) {
        const e = entity as {
          entityUrn?: string;
          $type?: string;
          commentary?: { text?: string | { text?: string } };
          createdAt?: number;
          '*actor'?: string;
          actor?: {
            name?: { text?: string };
            description?: { text?: string };
            subDescription?: { text?: string };
            backendUrn?: string;
            navigationContext?: { actionTarget?: string };
          };
          '*socialDetail'?: string;
          '*resharedUpdate'?: string;
          content?: Record<string, unknown>;
        };

        // Process update entities with PROFILE_REACTIONS flag
        if (
          e.entityUrn?.includes('fsd_update:') &&
          e.entityUrn?.includes('PROFILE_REACTIONS')
        ) {
          // Extract the activity URN from the update URN
          const activityMatch = e.entityUrn.match(/urn:li:activity:(\d+)/);
          const activityUrn = activityMatch
            ? `urn:li:activity:${activityMatch[1]}`
            : undefined;

          // Extract thread URN from socialDetail reference (used by reactions API)
          let ugcPostUrn: string | undefined;
          if (e['*socialDetail']) {
            const sdMatch = (e['*socialDetail'] as string).match(
              /fsd_socialDetail:\((urn:li:(?:ugcPost|activity):\d+)/,
            );
            if (sdMatch) {
              ugcPostUrn = sdMatch[1];
            }
          }

          // Get social counts; SocialDetail uses *totalSocialActivityCounts reference
          let likesCount: number | undefined;
          let commentsCount: number | undefined;
          let repostsCount: number | undefined;
          let userReactionType: Post['userReactionType'];

          if (e['*socialDetail']) {
            const socialDetail = entityMap[e['*socialDetail']] as
              | {
                  '*totalSocialActivityCounts'?: string;
                }
              | undefined;

            if (socialDetail?.['*totalSocialActivityCounts']) {
              const counts = entityMap[
                socialDetail['*totalSocialActivityCounts']
              ] as
                | {
                    numLikes?: number;
                    numComments?: number;
                    numShares?: number;
                    reacted?: string;
                  }
                | undefined;

              if (counts) {
                likesCount = counts.numLikes;
                commentsCount = counts.numComments;
                repostsCount = counts.numShares;
                // reacted contains the viewer's reaction type (populated for own profile)
                if (counts.reacted) {
                  userReactionType = counts.reacted as Post['userReactionType'];
                }
              }
            }
          }

          // Get author info (original post author)
          // Reactions tab uses inline actor objects, not *actor references
          let authorName: string | undefined;
          let authorHeadline: string | undefined;
          let authorMemberId: string | undefined;
          let authorVanityName: string | undefined;
          let relativeTime: string | undefined;

          if (e.actor) {
            authorName = e.actor.name?.text;
            authorHeadline = e.actor.description?.text;
            if (e.actor.backendUrn) {
              const memberMatch =
                e.actor.backendUrn.match(/urn:li:member:(\d+)/);
              if (memberMatch) {
                authorMemberId = memberMatch[1];
              }
            }
            if (e.actor.navigationContext?.actionTarget) {
              const vanityMatch =
                e.actor.navigationContext.actionTarget.match(/\/in\/([^/?]+)/);
              authorVanityName = vanityMatch?.[1];
            }
            // Extract relative time from actor.subDescription (e.g., "10mo", "2mo")
            if (e.actor.subDescription?.text) {
              const timeText = e.actor.subDescription.text.trim();
              const timeMatch = timeText.match(/^(\d+\w+)/);
              if (timeMatch) {
                relativeTime = timeMatch[1];
              }
            }
          } else if (e['*actor']) {
            const actor = entityMap[e['*actor']] as
              | {
                  name?: { text?: string };
                  description?: { text?: string };
                  subDescription?: { text?: string };
                  '*urn'?: string;
                  navigationUrl?: string;
                }
              | undefined;

            if (actor) {
              authorName = actor.name?.text;
              authorHeadline = actor.description?.text;
              if (actor['*urn']) {
                const urnEntity = entityMap[actor['*urn']] as
                  | { entityUrn?: string }
                  | undefined;
                authorMemberId = urnEntity?.entityUrn?.split(':').pop();
              }
              if (actor.navigationUrl) {
                const vanityMatch = actor.navigationUrl.match(/\/in\/([^/?]+)/);
                authorVanityName = vanityMatch?.[1];
              }
              // Extract relative time from resolved actor.subDescription
              if (actor.subDescription?.text) {
                const timeText = actor.subDescription.text.trim();
                const timeMatch = timeText.match(/^(\d+\w+)/);
                if (timeMatch) {
                  relativeTime = timeMatch[1];
                }
              }
            }
          }

          // Normalize authorMemberId to ACo format when possible
          if (authorMemberId && /^\d+$/.test(authorMemberId)) {
            for (const [key, val] of Object.entries(entityMap)) {
              if (!key.startsWith('urn:li:fsd_profile:')) continue;
              const profile = val as { backendUrn?: string };
              if (profile.backendUrn === `urn:li:member:${authorMemberId}`) {
                authorMemberId = key.split(':').pop()!;
                break;
              }
            }
          }

          // Extract text
          let postText: string | undefined;
          if (e.commentary?.text) {
            if (typeof e.commentary.text === 'string') {
              postText = e.commentary.text;
            } else if (
              typeof e.commentary.text === 'object' &&
              e.commentary.text.text
            ) {
              postText = e.commentary.text.text;
            }
          }

          // Detect media content and extract URLs
          const { imageUrl, videoUrl } = extractMediaUrls(
            e.content as Record<string, unknown> | undefined,
            entityMap,
          );
          const hasImage = !!imageUrl;
          const hasVideo = !!videoUrl;

          // Detect post type:
          // 1. *resharedUpdate reference → repost with commentary
          // 2. RESHARED in entityUrn tuple → instant repost
          let postType: 'original' | 'repost' | 'repost_with_commentary' =
            'original';
          let originalPostUrn: string | undefined;

          if (e['*resharedUpdate']) {
            postType = 'repost_with_commentary';
            const origMatch = (e['*resharedUpdate'] as string).match(
              /urn:li:activity:(\d+)/,
            );
            if (origMatch) {
              originalPostUrn = `urn:li:activity:${origMatch[1]}`;
            }
          } else if (e.entityUrn?.includes(',RESHARED,')) {
            postType = 'repost';
          }

          const isRepost = postType !== 'original';

          pagePosts.push({
            postUrn: e.entityUrn,
            activityUrn,
            ugcPostUrn,
            text: postText,
            timestamp: e.createdAt,
            relativeTime,
            likesCount,
            commentsCount,
            repostsCount,
            authorName,
            authorHeadline,
            authorMemberId,
            authorVanityName,
            authorProfileUrl: authorVanityName
              ? `https://www.linkedin.com/in/${authorVanityName}`
              : authorMemberId
                ? `https://www.linkedin.com/in/${authorMemberId}`
                : undefined,
            postType,
            isRepost,
            originalPostUrn,
            hasImage,
            hasVideo,
            imageUrl,
            videoUrl,
            postUrl: activityUrn
              ? `https://www.linkedin.com/feed/update/${activityUrn}`
              : undefined,
            userReactionType,
          });
        }
      }
    }

    // Sort by feed element order (included array is unordered)
    const paging = extractFeedPaging(resp);
    if (paging.elements) {
      pagePosts.sort((a, b) => {
        const idxA = a.postUrn ? paging.elements!.indexOf(a.postUrn) : -1;
        const idxB = b.postUrn ? paging.elements!.indexOf(b.postUrn) : -1;
        return (
          (idxA === -1 ? Infinity : idxA) - (idxB === -1 ? Infinity : idxB)
        );
      });
    }

    const seenUrns = new Set(
      allPosts.map((p) => p.activityUrn).filter(Boolean),
    );
    const dedupedPagePosts = pagePosts.filter((p) => {
      if (!p.activityUrn) return true;
      if (seenUrns.has(p.activityUrn)) return false;
      seenUrns.add(p.activityUrn);
      return true;
    });
    allPosts.push(...dedupedPagePosts);

    lastTotal = paging.total ?? lastTotal;
    paginationToken = paging.paginationToken;

    if (!paginationToken) break;
    if (pagePosts.length === 0) break;
  }

  const posts = allPosts.slice(start, start + count);
  const total =
    lastTotal !== undefined && lastTotal > 0 ? lastTotal : undefined;
  // LinkedIn always returns paginationToken and total:0; both are unreliable.
  const hasMore = posts.length >= count;

  return {
    posts,
    total,
    hasMore,
  };
}

export async function createPost(opts: {
  csrf: string;
  text: string;
  visibility?: 'ANYONE' | 'CONNECTIONS_ONLY';
  allowedCommenters?: 'ALL' | 'CONNECTIONS_ONLY' | 'NONE';
  imageBase64?: string;
  imageMimeType?: string;
}): Promise<CreatePostOutput> {
  const visibility = opts.visibility ?? 'ANYONE';
  const allowedCommenters = opts.allowedCommenters ?? 'ALL';

  // If image is provided, use GraphQL endpoint (supports media)
  if (opts.imageBase64) {
    const queryId = getQueryId(
      'voyagerContentcreationDashShares',
      'post-create',
    );

    const imageUrn = await uploadImage(
      opts.csrf,
      opts.imageBase64,
      opts.imageMimeType,
    );

    const post: Record<string, unknown> = {
      allowedCommentersScope: allowedCommenters,
      intendedShareLifeCycleState: 'PUBLISHED',
      origin: 'FEED',
      visibilityDataUnion: { visibilityType: visibility },
      commentary: { text: opts.text, attributesV2: [] },
      media: {
        category: 'IMAGE',
        mediaUrn: imageUrn,
        tapTargets: [],
        altText: '',
      },
    };

    interface GraphQLCreatePostResponse {
      data?: {
        data?: {
          createContentcreationDashShares?: {
            resourceKey?: string;
          };
        };
      };
    }

    const resp = await linkedinFetch<GraphQLCreatePostResponse>(
      opts.csrf,
      `/voyager/api/graphql?action=execute&queryId=${queryId}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify({
          variables: { post },
          queryId,
          includeWebMetadata: true,
        }),
      },
    );

    const resourceKey =
      resp?.data?.data?.createContentcreationDashShares?.resourceKey;
    if (!resourceKey) {
      throw new ContractDrift(
        `No resourceKey from createPost GraphQL. Response: ${JSON.stringify(resp)}`,
      );
    }

    // resourceKey format: urn:li:fsd_share:urn:li:share:XXX
    const shareMatch = resourceKey.match(/urn:li:share:(\d+)/);
    if (!shareMatch) {
      throw new ContractDrift(
        `Could not extract share URN from resourceKey: ${resourceKey}`,
      );
    }
    const shareUrn = shareMatch[0];
    // Share and activity URNs use the same numeric ID on LinkedIn
    const activityUrn = `urn:li:activity:${shareMatch[1]}`;

    return {
      shareUrn,
      activityUrn,
      postUrl: `https://www.linkedin.com/feed/update/${activityUrn}`,
    };
  }

  // Text-only: use the simpler REST endpoint
  const visibleToConnectionsOnly = visibility === 'CONNECTIONS_ONLY';

  interface CreatePostResponse {
    data?: {
      status?: {
        urn?: string;
        '*updateV2'?: string;
      };
    };
  }

  const resp = await linkedinFetch<CreatePostResponse>(
    opts.csrf,
    '/voyager/api/contentcreation/normShares',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({
        visibleToConnectionsOnly,
        externalAudienceProviders: [],
        commentaryV2: {
          text: opts.text,
          attributes: [],
        },
        origin: 'FEED',
        allowedCommentersScope: allowedCommenters,
        postType: 'DEFAULT',
      }),
    },
  );

  const shareUrn = resp.data?.status?.urn;
  if (!shareUrn) {
    throw new ContractDrift('No shareUrn returned from createPost');
  }

  // Extract activity URN from *updateV2 reference
  const updateV2Ref = resp.data?.status?.['*updateV2'];
  let activityUrn = '';
  if (updateV2Ref) {
    const activityMatch = updateV2Ref.match(/urn:li:activity:(\d+)/);
    if (activityMatch) {
      activityUrn = `urn:li:activity:${activityMatch[1]}`;
    }
  }

  if (!activityUrn) {
    throw new ContractDrift('Could not extract activityUrn from createPost response');
  }

  return {
    shareUrn,
    activityUrn,
    postUrl: `https://www.linkedin.com/feed/update/${activityUrn}`,
  };
}

export async function deletePost(opts: {
  csrf: string;
  postUrn: string;
}): Promise<DeletePostOutput> {
  // Accept activityUrn, shareUrn, or ugcPostUrn; resolve to shareUrn if needed
  let urn = opts.postUrn;
  if (urn.includes('urn:li:activity:')) {
    urn = await resolveShareUrn(opts.csrf, urn);
  }
  const encodedUrn = encodeUrn(urn);

  await linkedinFetch(
    opts.csrf,
    `/voyager/api/contentcreation/normShares/${encodedUrn}`,
    {
      method: 'DELETE',
    },
  );

  return { success: true };
}

export async function editPost(opts: {
  csrf: string;
  activityUrn: string;
  newText: string;
}): Promise<EditPostOutput> {
  const shareUrn = await resolveShareUrn(opts.csrf, opts.activityUrn);

  const queryId = getQueryId(
    'voyagerContentcreationDashShares',
    'update-content-creation-shares',
  );

  // Construct the updateUrn; LinkedIn uses this for feed cache invalidation
  const updateUrn = `urn:li:fsd_update:(${opts.activityUrn},FEED_DETAIL,EMPTY,DEFAULT,false)`;

  await linkedinFetch(
    opts.csrf,
    `/voyager/api/graphql?action=execute&queryId=${queryId}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        variables: {
          entity: {
            entity: {
              commentary: {
                text: opts.newText,
                attributesV2: [],
              },
            },
            resourceKey: shareUrn,
          },
          updateUrn,
        },
        queryId,
        includeWebMetadata: true,
      }),
    },
  );

  return { success: true };
}

/**
 * Resolve the shareUrn (ugcPost/share URN) from an activityUrn.
 * LinkedIn's feed/updates endpoint returns the UpdateV2 entity in the included array.
 */
async function resolveShareUrn(
  csrf: string,
  activityUrn: string,
): Promise<string> {
  interface FeedUpdateResponse {
    included?: Array<{
      $type?: string;
      entityUrn?: string;
      updateMetadata?: { shareUrn?: string };
    }>;
  }

  const feedResp = await linkedinFetch<FeedUpdateResponse>(
    csrf,
    `/voyager/api/feed/updates/${encodeURIComponent(activityUrn)}?updateLookupType=FEED_DETAIL`,
  );

  const updateV2 = feedResp?.included?.find(
    (e) =>
      e.$type === 'com.linkedin.voyager.feed.render.UpdateV2' &&
      e.entityUrn?.includes(activityUrn),
  );

  const shareUrn = updateV2?.updateMetadata?.shareUrn;
  if (!shareUrn) {
    // Fresh posts may not be in the feed cache yet. The activity ID and share ID
    // are typically the same numeric value, so try constructing the shareUrn directly.
    const numericId = activityUrn.match(/\d+$/)?.[0];
    if (numericId) {
      return `urn:li:share:${numericId}`;
    }
    throw new NotFound(
      `Could not resolve shareUrn for ${activityUrn}. Ensure the post exists.`,
    );
  }
  return shareUrn;
}

export async function repostPost(opts: {
  csrf: string;
  activityUrn: string;
  commentary?: string;
}): Promise<RepostPostOutput> {
  const shareUrn = await resolveShareUrn(opts.csrf, opts.activityUrn);

  // Repost with commentary uses the GraphQL post-create mutation
  if (opts.commentary) {
    const queryId = getQueryId(
      'voyagerContentcreationDashShares',
      'post-create',
    );

    await linkedinFetch(
      opts.csrf,
      `/voyager/api/graphql?action=execute&queryId=${queryId}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          variables: {
            post: {
              allowedCommentersScope: 'ALL',
              intendedShareLifeCycleState: 'PUBLISHED',
              origin: 'RESHARE',
              visibilityDataUnion: { visibilityType: 'ANYONE' },
              commentary: { text: opts.commentary, attributesV2: [] },
              parentUrn: shareUrn,
            },
          },
          queryId,
          includeWebMetadata: true,
        }),
      },
    );

    return { success: true };
  }

  // Instant repost (no commentary) uses the GraphQL mutation
  const queryId = getQueryId('voyagerFeedDashReposts', 'create-dash-reposts');

  await linkedinFetch(
    opts.csrf,
    `/voyager/api/graphql?action=execute&queryId=${queryId}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        variables: { entity: { rootContentUrn: shareUrn } },
        queryId,
        includeWebMetadata: true,
      }),
    },
  );

  return { success: true };
}

export async function undoRepost(opts: {
  csrf: string;
  activityUrn: string;
}): Promise<UndoRepostOutput> {
  // Step 1: Find the repost's resourceKey from the profile feed actions.
  // The DELETE_REPOST action's targetUrn contains the fsd_repost URN needed.
  const memberId = await resolveMemberId(opts.csrf);
  const resourceKey = await findRepostResourceKey(
    opts.csrf,
    memberId,
    opts.activityUrn,
  );

  // Step 2: Execute the delete mutation with the resourceKey
  const queryId = getQueryId(
    'voyagerFeedDashReposts',
    'delete-feed-dash-repost-by-urn',
  );

  await linkedinFetch(
    opts.csrf,
    `/voyager/api/graphql?action=execute&queryId=${queryId}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        variables: { resourceKey },
        queryId,
        includeWebMetadata: true,
      }),
    },
  );

  return { success: true };
}

async function resolveMemberId(csrf: string): Promise<string> {
  interface MeResponse {
    included?: Array<{
      $type?: string;
      entityUrn?: string;
    }>;
  }
  const resp = await linkedinFetch<MeResponse>(csrf, '/voyager/api/me');
  const miniProfile = resp?.included?.find(
    (e) =>
      e.$type === 'com.linkedin.voyager.identity.shared.MiniProfile' &&
      e.entityUrn,
  );
  const match = miniProfile?.entityUrn?.match(/ACoAA[A-Za-z0-9_-]+/);
  if (!match)
    throw new ContractDrift('Could not resolve memberId from /voyager/api/me');
  return match[0];
}

interface UpdateAction {
  actionType?: string;
  targetUrn?: string;
}

interface UpdateActionsEntity {
  $type?: string;
  entityUrn?: string;
  actions?: UpdateAction[];
}

async function findRepostResourceKey(
  csrf: string,
  memberId: string,
  activityUrn: string,
): Promise<string> {
  // Resolve the shareUrn first; the DELETE_REPOST targetUrn contains it
  const shareUrn = await resolveShareUrn(csrf, activityUrn);

  interface ProfileUpdatesResponse {
    included?: UpdateActionsEntity[];
  }

  const resp = await linkedinFetch<ProfileUpdatesResponse>(
    csrf,
    `/voyager/api/identity/profileUpdatesV2?includeLongTermHistory=true&moduleKey=creator_profile_all_content_view%3Adesktop&numComments=0&numLikes=0&profileUrn=urn%3Ali%3Afsd_profile%3A${memberId}&q=memberShareFeed&start=0&count=50`,
  );

  // Search all UpdateActions entities for a DELETE_REPOST action whose
  // targetUrn contains the shareUrn (reposts get a new activityUrn)
  const allActions = (resp?.included ?? []).filter(
    (e) => e.$type === 'com.linkedin.voyager.feed.render.UpdateActions',
  );

  for (const entity of allActions) {
    const deleteAction = entity.actions?.find(
      (a) =>
        a.actionType === 'DELETE_REPOST' && a.targetUrn?.includes(shareUrn),
    );
    if (deleteAction?.targetUrn) {
      return deleteAction.targetUrn;
    }
  }

  throw new NotFound(
    `No DELETE_REPOST action found for ${activityUrn} (shareUrn: ${shareUrn}). The post may not be a repost by this user.`,
  );
}

/**
 * Upload a base64-encoded image to LinkedIn and return the digitalmediaAsset URN.
 *
 * Flow: register (action=upload) → PUT binary to singleUploadUrl (201).
 * LinkedIn's CSP blocks fetch() to external URLs from the page context,
 * so only base64 input is supported. The caller must provide the image data.
 */
async function uploadImage(
  csrf: string,
  imageBase64: string,
  mimeType: string = 'image/jpeg',
  filename: string = 'image.jpg',
): Promise<string> {
  const binary = atob(imageBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: mimeType });

  interface UploadRegisterResponse {
    data?: {
      value?: {
        singleUploadUrl?: string;
        singleUploadHeaders?: Record<string, string>;
        urn?: string;
      };
    };
  }

  const registerResp = await linkedinFetch<UploadRegisterResponse>(
    csrf,
    '/voyager/api/voyagerVideoDashMediaUploadMetadata?action=upload',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mediaUploadType: 'IMAGE_SHARING',
        fileSize: blob.size,
        filename,
      }),
    },
  );

  const uploadUrl = registerResp?.data?.value?.singleUploadUrl;
  const urn = registerResp?.data?.value?.urn;
  const extraHeaders = registerResp?.data?.value?.singleUploadHeaders;

  if (!uploadUrl || !urn) {
    throw new ContractDrift(
      `Image upload registration failed. Response: ${JSON.stringify(registerResp)}`,
    );
  }

  const putHeaders: Record<string, string> = {
    'csrf-token': csrf,
    'Content-Type': mimeType,
  };
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) {
      putHeaders[k] = v;
    }
  }

  const putResponse = await fetch(uploadUrl, {
    method: 'PUT',
    credentials: 'include',
    headers: putHeaders,
    body: blob,
  });

  if (!putResponse.ok) {
    throwForStatus(putResponse.status, `Failed to upload image binary: ${putResponse.status}`);
  }

  return urn;
}

export async function schedulePost(opts: {
  csrf: string;
  text: string;
  scheduledAt: number;
  visibility?: 'ANYONE' | 'CONNECTIONS_ONLY';
  allowedCommenters?: 'ALL' | 'CONNECTIONS_ONLY' | 'NONE';
  imageBase64?: string;
  imageMimeType?: string;
}): Promise<SchedulePostOutput> {
  validateScheduledAt(opts.scheduledAt);

  const visibility = opts.visibility ?? 'ANYONE';
  const allowedCommenters = opts.allowedCommenters ?? 'ALL';

  const queryId = getQueryId('voyagerContentcreationDashShares', 'post-create');

  // Build the post object
  const post: Record<string, unknown> = {
    allowedCommentersScope: allowedCommenters,
    intendedShareLifeCycleState: 'SCHEDULED',
    origin: 'PROFILE',
    visibilityDataUnion: { visibilityType: visibility },
    commentary: { text: opts.text, attributesV2: [] },
    scheduledAt: String(opts.scheduledAt),
  };

  // Upload image if provided
  if (opts.imageBase64) {
    const imageUrn = await uploadImage(
      opts.csrf,
      opts.imageBase64,
      opts.imageMimeType,
    );
    post.media = {
      category: 'IMAGE',
      mediaUrn: imageUrn,
      tapTargets: [],
      altText: '',
    };
  }

  interface SchedulePostResponse {
    data?: {
      data?: {
        createContentcreationDashShares?: {
          resourceKey?: string;
          '*entity'?: string;
        };
      };
    };
  }

  const resp = await linkedinFetch<SchedulePostResponse>(
    opts.csrf,
    `/voyager/api/graphql?action=execute&queryId=${queryId}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({
        variables: { post },
        queryId,
        includeWebMetadata: true,
      }),
    },
  );

  // Extract share URN from resourceKey (format: urn:li:fsd_share:urn:li:share:XXX)
  const resourceKey =
    resp?.data?.data?.createContentcreationDashShares?.resourceKey ??
    resp?.data?.data?.createContentcreationDashShares?.['*entity'];
  let shareUrn: string | undefined;
  if (resourceKey) {
    const match = resourceKey.match(/urn:li:share:\d+/);
    shareUrn = match ? match[0] : resourceKey;
  }

  return {
    success: true,
    shareUrn,
  };
}

export async function listScheduledPosts(opts: {
  csrf: string;
  start?: number;
  count?: number;
}): Promise<ListScheduledPostsOutput> {
  const start = opts.start ?? 0;
  const count = opts.count ?? 20;

  const queryId = getQueryId(
    'voyagerContentcreationDashSharePreviews',
    'fetch-schedule-post-management',
  );

  const vars = encodeVars({
    shareLifeCycleState: 'SCHEDULED',
    start,
    count,
  });

  interface SharePreviewElement {
    scheduledAt?: number;
    '*miniUpdate'?: string;
    contextualDescription?: { text?: string };
    errorMessage?: { text?: string };
  }

  interface MiniUpdateIncluded {
    entityUrn?: string;
    $type?: string;
    commentary?: {
      commentaryText?: { text?: string };
    };
    content?: unknown;
  }

  interface SharePreviewResponse {
    data?: {
      data?: {
        contentcreationDashSharePreviewsByShareLifeCycleState?: {
          paging?: { total?: number };
          elements?: SharePreviewElement[];
        };
      };
    };
    included?: MiniUpdateIncluded[];
  }

  const resp = await linkedinFetch<SharePreviewResponse>(
    opts.csrf,
    `/voyager/api/graphql?includeWebMetadata=true&variables=${vars}&queryId=${queryId}`,
  );

  const container =
    resp?.data?.data?.contentcreationDashSharePreviewsByShareLifeCycleState;
  const total = container?.paging?.total;
  const rawElements = container?.elements ?? [];

  // Build lookup from included MiniUpdate entities (keyed by backendUrn = shareUrn)
  const included = resp?.included ?? [];
  const miniUpdateByShareUrn = new Map<string, MiniUpdateIncluded>();
  for (const item of included) {
    if (item.$type === 'com.linkedin.voyager.dash.feed.miniupdate.MiniUpdate') {
      // backendUrn is nested inside metadata
      const metadata = (item as Record<string, unknown>).metadata as
        | { backendUrn?: string }
        | undefined;
      if (metadata?.backendUrn) {
        miniUpdateByShareUrn.set(metadata.backendUrn, item);
      }
    }
  }

  const scheduledPosts: ScheduledPost[] = [];

  for (const el of rawElements) {
    // Extract shareUrn from the *miniUpdate reference
    // Format: urn:li:fsd_miniUpdate:(urn:li:share:XXX,SHARE_MANAGEMENT)
    let shareUrn: string | undefined;
    const miniUpdateRef = el['*miniUpdate'];
    if (miniUpdateRef) {
      const urnMatch = miniUpdateRef.match(/urn:li:(?:ugcPost|share):\d+/);
      if (urnMatch) {
        shareUrn = urnMatch[0];
      }
    }

    // Get actual post text from included MiniUpdate entity
    let postText = '';
    let hasImage = false;
    let hasVideo = false;
    if (shareUrn) {
      const miniUpdate = miniUpdateByShareUrn.get(shareUrn);
      if (miniUpdate) {
        postText = miniUpdate.commentary?.commentaryText?.text ?? '';
        hasImage = miniUpdate.content != null;
        hasVideo = false; // TODO: detect video content type
      }
    }

    // Fall back to contextualDescription (schedule info like "Posting Thu, Feb 26 at 12:15 PM")
    const scheduleDescription = el.contextualDescription?.text;

    // Build human-readable local time string
    let scheduledAtLocal: string | undefined;
    if (el.scheduledAt) {
      const d = new Date(el.scheduledAt);
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const months = [
        'Jan',
        'Feb',
        'Mar',
        'Apr',
        'May',
        'Jun',
        'Jul',
        'Aug',
        'Sep',
        'Oct',
        'Nov',
        'Dec',
      ];
      const h = d.getHours();
      const m = d.getMinutes();
      const ampm = h >= 12 ? 'PM' : 'AM';
      const h12 = h % 12 || 12;
      const minStr = m === 0 ? '' : `:${String(m).padStart(2, '0')}`;
      scheduledAtLocal = `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()} at ${h12}${minStr} ${ampm}`;
    }

    scheduledPosts.push({
      shareUrn,
      scheduledAt: el.scheduledAt,
      scheduledAtLocal,
      text: postText || scheduleDescription || '',
      hasImage,
      hasVideo,
      errorMessage: el.errorMessage?.text,
    });
  }

  return { scheduledPosts, total };
}

/**
 * Edit the text of a scheduled (not yet published) post.
 * Uses the same update mutation as editPost but includes scheduledAt to preserve the schedule.
 */
export async function editScheduledPost(opts: {
  csrf: string;
  shareUrn: string;
  newText: string;
  scheduledAt: number;
}): Promise<EditScheduledPostOutput> {
  validateScheduledAt(opts.scheduledAt);

  const updateQueryId = getQueryId(
    'voyagerContentcreationDashShares',
    'update-content-creation-shares',
  );

  await linkedinFetch(
    opts.csrf,
    `/voyager/api/graphql?action=execute&queryId=${updateQueryId}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        variables: {
          entity: {
            entity: {
              commentary: {
                text: opts.newText,
                attributesV2: [],
              },
              scheduledAt: String(opts.scheduledAt),
            },
            resourceKey: opts.shareUrn,
          },
        },
        queryId: updateQueryId,
        includeWebMetadata: true,
      }),
    },
  );

  return { success: true };
}

/**
 * Change the scheduled publication time of a scheduled post.
 * Does not change the post content.
 */
export async function reschedulePost(opts: {
  csrf: string;
  shareUrn: string;
  scheduledAt: number;
}): Promise<ReschedulePostOutput> {
  validateScheduledAt(opts.scheduledAt);

  const queryId = getQueryId(
    'voyagerContentcreationDashShares',
    'update-content-creation-shares',
  );

  await linkedinFetch(
    opts.csrf,
    `/voyager/api/graphql?action=execute&queryId=${queryId}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        variables: {
          entity: {
            entity: {
              scheduledAt: String(opts.scheduledAt),
            },
            resourceKey: opts.shareUrn,
          },
        },
        queryId,
      }),
    },
  );

  return { success: true };
}
