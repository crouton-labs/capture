/**
 * X (Twitter) Library
 *
 * Browser-executable X operations via internal GraphQL API.
 * Requires user to be logged into X.
 */

export type {
  Tweet,
  UserProfile,
  Notification,
  DMConversation,
  GetContextOutput,
  ListMyPostsOutput,
  ListMyPostsInput,
  CreatePostOutput,
  CreatePostInput,
  SearchPostsOutput,
  SearchPostsInput,
  LikePostOutput,
  LikePostInput,
  CreateRepostOutput,
  CreateRepostInput,
  GetProfileOutput,
  GetProfileInput,
  FollowUserOutput,
  FollowUserInput,
  UnfollowUserOutput,
  UnfollowUserInput,
  UnlikePostOutput,
  UnlikePostInput,
  DeletePostOutput,
  DeletePostInput,
  DeleteRepostOutput,
  DeleteRepostInput,
  BookmarkPostOutput,
  BookmarkPostInput,
  UnbookmarkPostOutput,
  UnbookmarkPostInput,
  ListBookmarksOutput,
  ListBookmarksInput,
  GetForYouTimelineOutput,
  GetForYouTimelineInput,
  GetFollowingTimelineOutput,
  GetFollowingTimelineInput,
  GetUserPostsOutput,
  GetUserPostsInput,
  GetUserRepliesOutput,
  GetUserRepliesInput,
  GetUserLikesOutput,
  GetUserLikesInput,
  ListNotificationsOutput,
  ListNotificationsInput,
  UpdateProfileOutput,
  UpdateProfileInput,
  SendDMOutput,
  SendDMInput,
  ListDMInboxOutput,
  ListDMInboxInput,
  CreatePollPostOutput,
  CreatePollPostInput,
  CreateScheduledPostOutput,
  CreateScheduledPostInput,
  ListScheduledPostsOutput,
  ListScheduledPostsInput,
  DeleteScheduledPostOutput,
  DeleteScheduledPostInput,
  GetDMConversationOutput,
  GetDMConversationInput,
  DeleteDMConversationOutput,
  DeleteDMConversationInput,
  ReactToDMOutput,
  ReactToDMInput,
  RemoveReactionOutput,
  RemoveReactionInput,
  SendDMImageOutput,
  SendDMImageInput,
  DeleteDMOutput,
  DeleteDMInput,
  ListAccountsOutput,
  ListAccountsInput,
  SwitchAccountOutput,
  SwitchAccountInput,
  GetPostInput,
  GetPostOutput,
  CreateThreadInput,
  CreateThreadOutput,
  EditPostInput,
  EditPostOutput,
  PinTweetInput,
  PinTweetOutput,
  UnpinTweetInput,
  UnpinTweetOutput,
  ListFollowersInput,
  ListFollowersOutput,
  ListFollowingInput,
  ListFollowingOutput,
  SearchUsersInput,
  SearchUsersOutput,
  GetLikersInput,
  GetLikersOutput,
  GetRepostersInput,
  GetRepostersOutput,
  BlockUserInput,
  BlockUserOutput,
  UnblockUserInput,
  UnblockUserOutput,
  MuteUserInput,
  MuteUserOutput,
  UnmuteUserInput,
  UnmuteUserOutput,
  GetTrendsInput,
  GetTrendsOutput,
  ListTrendLocationsInput,
  ListTrendLocationsOutput,
  GetTrendsByLocationInput,
  GetTrendsByLocationOutput,
  GetListInput,
  GetListOutput,
  ListUserListsInput,
  ListUserListsOutput,
  GetListMembersInput,
  GetListMembersOutput,
  GetListTimelineInput,
  GetListTimelineOutput,
  CreateListInput,
  CreateListOutput,
  DeleteListInput,
  DeleteListOutput,
  AddListMemberInput,
  AddListMemberOutput,
  RemoveListMemberInput,
  RemoveListMemberOutput,
  FollowListInput,
  FollowListOutput,
  UnfollowListInput,
  UnfollowListOutput,
  GetArticleInput,
  GetArticleOutput,
  GetUserArticlesInput,
  GetUserArticlesOutput,
} from './schemas';

import { Validation, ContractDrift, NotFound, PermissionDenied, Unauthenticated, UpstreamError, throwForStatus } from '@vallum/_runtime';

import type {
  GetContextOutput,
  ListMyPostsInput,
  ListMyPostsOutput,
  CreatePostInput,
  CreatePostOutput,
  SearchPostsInput,
  SearchPostsOutput,
  LikePostInput,
  LikePostOutput,
  CreateRepostInput,
  CreateRepostOutput,
  GetProfileInput,
  GetProfileOutput,
  FollowUserInput,
  FollowUserOutput,
  UnfollowUserInput,
  UnfollowUserOutput,
  UnlikePostInput,
  UnlikePostOutput,
  DeletePostInput,
  DeletePostOutput,
  DeleteRepostInput,
  DeleteRepostOutput,
  BookmarkPostInput,
  BookmarkPostOutput,
  UnbookmarkPostInput,
  UnbookmarkPostOutput,
  ListBookmarksInput,
  ListBookmarksOutput,
  GetForYouTimelineInput,
  GetForYouTimelineOutput,
  GetFollowingTimelineInput,
  GetFollowingTimelineOutput,
  GetUserPostsInput,
  GetUserPostsOutput,
  GetUserRepliesInput,
  GetUserRepliesOutput,
  GetUserLikesInput,
  GetUserLikesOutput,
  Notification,
  ListNotificationsInput,
  ListNotificationsOutput,
  UpdateProfileInput,
  UpdateProfileOutput,
  SendDMInput,
  SendDMOutput,
  ListDMInboxInput,
  ListDMInboxOutput,
  CreatePollPostInput,
  CreatePollPostOutput,
  CreateScheduledPostInput,
  CreateScheduledPostOutput,
  ListScheduledPostsInput,
  ListScheduledPostsOutput,
  DeleteScheduledPostInput,
  DeleteScheduledPostOutput,
  GetDMConversationInput,
  GetDMConversationOutput,
  DeleteDMConversationInput,
  DeleteDMConversationOutput,
  ReactToDMInput,
  ReactToDMOutput,
  RemoveReactionInput,
  RemoveReactionOutput,
  SendDMImageInput,
  SendDMImageOutput,
  DeleteDMInput,
  DeleteDMOutput,
  ListAccountsInput,
  ListAccountsOutput,
  SwitchAccountInput,
  SwitchAccountOutput,
  GetPostInput,
  GetPostOutput,
  CreateThreadInput,
  CreateThreadOutput,
  EditPostInput,
  EditPostOutput,
  PinTweetInput,
  PinTweetOutput,
  UnpinTweetInput,
  UnpinTweetOutput,
  ListFollowersInput,
  ListFollowersOutput,
  ListFollowingInput,
  ListFollowingOutput,
  SearchUsersInput,
  SearchUsersOutput,
  GetLikersInput,
  GetLikersOutput,
  GetRepostersInput,
  GetRepostersOutput,
  BlockUserInput,
  BlockUserOutput,
  UnblockUserInput,
  UnblockUserOutput,
  MuteUserInput,
  MuteUserOutput,
  UnmuteUserInput,
  UnmuteUserOutput,
  GetTrendsInput,
  GetTrendsOutput,
  ListTrendLocationsInput,
  ListTrendLocationsOutput,
  GetTrendsByLocationInput,
  GetTrendsByLocationOutput,
  GetListInput,
  GetListOutput,
  ListUserListsInput,
  ListUserListsOutput,
  GetListMembersInput,
  GetListMembersOutput,
  GetListTimelineInput,
  GetListTimelineOutput,
  CreateListInput,
  CreateListOutput,
  DeleteListInput,
  DeleteListOutput,
  AddListMemberInput,
  AddListMemberOutput,
  RemoveListMemberInput,
  RemoveListMemberOutput,
  FollowListInput,
  FollowListOutput,
  UnfollowListInput,
  UnfollowListOutput,
  GetArticleInput,
  GetArticleOutput,
  GetUserArticlesInput,
  GetUserArticlesOutput,
  XList,
  Tweet,
  UserProfile,
} from './schemas';

// ============================================================================
// Constants
// ============================================================================

// X's public bearer token; same for all users, baked into the web app JS.
const BEARER_TOKEN =
  'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

// Feature flags required by the UserTweets GraphQL endpoint.
const GRAPHQL_FEATURES = {
  rweb_video_screen_enabled: false,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_profile_redirect_enabled: false,
  rweb_tipjar_consumption_enabled: false,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  premium_content_api_read_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: true,
  responsive_web_jetfuel_frame: true,
  responsive_web_grok_share_attachment_enabled: true,
  responsive_web_grok_annotations_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  responsive_web_grok_show_grok_translated_post: true,
  responsive_web_grok_analysis_button_from_backend: true,
  post_ctas_fetch_enabled: true,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: false,
  content_disclosure_indicator_enabled: true,
  content_disclosure_ai_generated_indicator_enabled: true,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_grok_imagine_annotation_enabled: true,
  responsive_web_grok_community_note_auto_translation_is_enabled: false,
  responsive_web_enhance_cards_enabled: false,
};

// ============================================================================
// Helpers
// ============================================================================

/** In-memory cache for discovered GraphQL query hashes (per session) */
const queryHashCache: Record<string, string> = {};

/**
 * Discover the GraphQL query hash for an operation name by searching
 * the page's loaded JS bundles.
 *
 * X bundles contain entries like:
 *   {queryId:"eApPT8jppbYXlweF_ByTyA",operationName:"UserTweets",...}
 */
async function discoverQueryHash(operationName: string): Promise<string> {
  if (queryHashCache[operationName]) return queryHashCache[operationName];

  // Scan loaded module EXPORTS once for resolved {queryId, operationName} op
  // definitions. This is what makes CORE ops reliable from any page: ops like
  // UserTweets/Followers/Following/SearchTimeline/UserByScreenName bind their
  // operationName to a variable in source (invisible to text scans) but it is a
  // resolved string at runtime. Fast (no network); bulk-populates the cache.
  if (!moduleExportsScanned) {
    moduleExportsScanned = true;
    try {
      scanModuleExportsForHashes();
    } catch {
      // Best effort — fall through to the other strategies.
    }
    if (queryHashCache[operationName]) return queryHashCache[operationName];
  }

  // Check performance entries first (if the page already made this request)
  for (const entry of performance.getEntriesByType('resource')) {
    if (!entry.name.includes('/graphql/')) continue;
    const match = entry.name.match(
      new RegExp(`/graphql/([^/]+)/${operationName}`),
    );
    if (match) {
      queryHashCache[operationName] = match[1];
      return match[1];
    }
  }

  // Search webpack chunks in memory (covers async-loaded bundles)
  const pattern = new RegExp(
    `queryId:"([^"]+)",operationName:"${operationName}"`,
  );
  const chunks = (window as unknown as Record<string, unknown[][]>)
    .webpackChunk_twitter_responsive_web;
  if (chunks) {
    for (const chunk of chunks) {
      const modules = chunk[1] as Record<string, (...args: unknown[]) => void>;
      if (!modules || typeof modules !== 'object') continue;
      for (const moduleFunc of Object.values(modules)) {
        if (typeof moduleFunc !== 'function') continue;
        try {
          const source = moduleFunc.toString();
          const match = source.match(pattern);
          if (match) {
            queryHashCache[operationName] = match[1];
            return match[1];
          }
        } catch {
          // Some modules may throw on toString
        }
      }
    }
  }

  // Last resort: sweep X's lazy-loaded JS bundles for the hash (once per
  // session). The module-export scan above already covers core ops and loaded
  // leaf ops; this catches leaf ops (Favoriters/Retweeters/bookmark/…) whose
  // chunks aren't loaded on the current surface, so callers don't have to
  // navigate to e.g. a likes page first.
  if (!bundleSweepRan) {
    bundleSweepRan = true;
    await sweepBundlesForQueryHashes(operationName);
    if (queryHashCache[operationName]) return queryHashCache[operationName];
  }

  throw new ContractDrift(
    `Could not find query hash for ${operationName}. Ensure you are logged into x.com.`,
  );
}

/** Session flag so the module-export scan runs at most once. */
let moduleExportsScanned = false;

/**
 * Walk every loaded webpack module's EXPORTS for GraphQL operation definitions
 * shaped like `{ queryId, operationName, operationType, metadata }`, populating
 * queryHashCache. Unlike a bundle-source scan, this sees the RESOLVED
 * operationName string even when the source bound it to a variable, so it
 * captures core ops (UserTweets/Followers/Following/SearchTimeline/Likes/
 * HomeTimeline/UserByScreenName/…). Synchronous, no network. Verified live
 * (June 2026): resolves all of the above from a cold /home.
 */
function scanModuleExportsForHashes(): void {
  const chunks = (window as unknown as Record<string, unknown[]>)
    .webpackChunk_twitter_responsive_web;
  if (!chunks) return;

  type WebpackCache = { c?: Record<string, { exports?: unknown }> };
  const holder: { ref: WebpackCache | null } = { ref: null };
  chunks.push([
    [`__vallum_opreg_${Date.now()}_${Math.random()}`],
    {},
    (r: WebpackCache) => {
      holder.ref = r;
    },
  ]);
  const cache = holder.ref?.c;
  if (!cache) return;

  const visit = (value: unknown, depth: number): void => {
    if (!value || typeof value !== 'object' || depth > 3) return;
    const rec = value as Record<string, unknown>;
    if (
      typeof rec.queryId === 'string' &&
      typeof rec.operationName === 'string'
    ) {
      if (!queryHashCache[rec.operationName]) {
        queryHashCache[rec.operationName] = rec.queryId;
      }
      return;
    }
    for (const key in rec) {
      try {
        const child = rec[key];
        if (child && typeof child === 'object') visit(child, depth + 1);
      } catch {
        // A getter threw — skip it.
      }
    }
  };

  for (const id in cache) {
    try {
      visit(cache[id]?.exports, 0);
    } catch {
      // Skip modules that throw on access.
    }
  }
}

/**
 * Session flag so we sweep the bundles at most once. A miss after a full sweep
 * means the op binds its operationName via a variable (core timeline ops) and
 * is only resolvable from a fired request — re-sweeping would just burn fetches.
 */
let bundleSweepRan = false;

/**
 * Enumerate X's webpack chunk URLs from the runtime chunk map and scan their JS
 * for `queryId`/`operationName` literal pairs, bulk-populating queryHashCache.
 *
 * The chunk id→filename map is inlined in webpack's `u()` function source, and
 * `publicPath + u(id)` yields a fetchable URL. Feature bundles (`bundle.*`,
 * `shared~bundle.*`) are fetched first since that is where GraphQL ops live, and
 * the sweep stops as soon as the requested op is found — so the common case is a
 * few hundred ms, not a full crawl. Verified live (June 2026): from /home this
 * resolves Favoriters/Retweeters, which are absent from the home surface.
 */
async function sweepBundlesForQueryHashes(targetOp: string): Promise<void> {
  const chunks = (window as unknown as Record<string, unknown[]>)
    .webpackChunk_twitter_responsive_web;
  if (!chunks) return;

  type WebpackRequire = { u: (id: number) => string; p?: string };
  const holder: { ref: WebpackRequire | null } = { ref: null };
  chunks.push([
    [`__vallum_hashsweep_${Date.now()}_${Math.random()}`],
    {},
    (r: WebpackRequire) => {
      holder.ref = r;
    },
  ]);
  // webpack invokes the callback synchronously during push(), so ref is set.
  const req = holder.ref;
  if (!req || typeof req.u !== 'function') return;
  const u = req.u.bind(req);
  const publicPath = req.p ?? '';

  const idNamePairs = [...req.u.toString().matchAll(/(\d+):"([^"]+)"/g)].map(
    (m) => ({ id: Number(m[1]), name: m[2] }),
  );
  if (!idNamePairs.length) return;

  // Skip chunks that never carry GraphQL ops (locales, emoji, vendored libs).
  const skip =
    /i18n|emoji|syntax-highlighter|countries|country|\/locale|hljs|katex/i;
  // Fetch feature bundles first — that's where GraphQL ops are defined.
  const rank = (name: string) =>
    /^(shared~)?bundle\./.test(name) ? 0 : name.startsWith('ondemand.') ? 2 : 1;
  const candidates = idNamePairs
    .filter((c) => !skip.test(c.name))
    .sort((a, b) => rank(a.name) - rank(b.name));

  const pairPat =
    /(?:queryId:"([^"]+)",operationName:"([A-Za-z0-9_]+)")|(?:operationName:"([A-Za-z0-9_]+)",queryId:"([^"]+)")/g;
  const CONCURRENCY = 48;
  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    await Promise.all(
      candidates.slice(i, i + CONCURRENCY).map(async (c) => {
        let text: string;
        try {
          text = await (await fetch(publicPath + u(c.id))).text();
        } catch {
          return;
        }
        pairPat.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = pairPat.exec(text))) {
          const op = m[2] ?? m[3];
          const hash = m[1] ?? m[4];
          if (op && hash && !queryHashCache[op]) queryHashCache[op] = hash;
        }
      }),
    );
    if (queryHashCache[targetOp]) break; // found it — stop early
  }
}

/**
 * Read the fresh ct0 cookie value. X rotates CSRF tokens, so the header
 * must always match the current cookie; never use a stale value.
 */
function freshCsrf(): string {
  for (const cookie of document.cookie.split(';')) {
    const trimmed = cookie.trim();
    if (trimmed.startsWith('ct0=')) return trimmed.substring(4);
  }
  throw new Unauthenticated(
    `CSRF token (ct0 cookie) not found. URL: ${window.location.href}`,
  );
}

/** Cached reference to X's transaction ID generator function */
let cachedTxGenerator:
  | ((host: string, path: string, method: string) => Promise<string>)
  | null = null;

/**
 * Generate x-client-transaction-id using X's own WASM-based generator.
 * X requires this header to verify the request comes from the real web app.
 * Without it, mutations return 344 "daily limit" errors.
 *
 * The generator module is discovered dynamically by searching webpack's module
 * cache for a module containing the stable feature flag string
 * "rweb_client_transaction_id_enabled". The generator function is identified
 * by arity: it takes exactly 3 args (host, path, method). The reference is
 * cached for the session and invalidated on error.
 */
/**
 * Randomized pre-mutation delay (anti-automation timing jitter). Machine-uniform,
 * sub-millisecond spacing between writes is itself a detection signal; a random
 * pause makes write timing look human. Mirrors LinkedIn's jitter
 * (libs/linkedin/connections/index.ts): usually 500–1500ms, with a 1-in-10
 * chance of a longer ~4s pause. Orthogonal to the rate limits in schemas.ts:
 * limits cap how many; jitter randomizes when.
 */
async function mutationJitter(): Promise<void> {
  // 1-in-10 chance of a longer 4-second pause to appear more human.
  const ms =
    Math.random() < 0.1 ? 4000 : 500 + Math.floor(Math.random() * 1000);
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateTransactionId(
  path: string,
  method: string,
): Promise<string> {
  // Every mutation funnels through here with a non-GET method to mint the
  // x-client-transaction-id header (reads pass 'GET'); jitter writes here so a
  // single chokepoint covers all of them without delaying reads.
  if (method !== 'GET') await mutationJitter();
  try {
    // Try cached generator first
    if (cachedTxGenerator) {
      try {
        return await cachedTxGenerator('x.com', path, method);
      } catch {
        cachedTxGenerator = null;
      }
    }

    // Access webpack's internal require via the chunk push trick
    let webpackRequire: ((id: number) => Record<string, unknown>) | null = null;
    const chunks = (window as unknown as Record<string, unknown[]>)
      .webpackChunk_twitter_responsive_web;
    if (!chunks) throw new Unauthenticated('X webpack chunks not found');

    chunks.push([
      [`__vallum_probe_${Date.now()}_${Math.random()}`],
      {},
      (req: (id: number) => Record<string, unknown>) => {
        webpackRequire = req;
      },
    ]);

    if (!webpackRequire) throw new UpstreamError('Could not access webpack require');

    // Search module cache for the transaction ID module.
    // The module that sets x-client-transaction-id contains the feature flag
    // string "rweb_client_transaction_id_enabled" in one of its exports.
    // The generator is the 3-arg function on the same module.
    const cache = (
      webpackRequire as unknown as {
        c: Record<string, { exports?: Record<string, unknown> }>;
      }
    ).c;

    for (const moduleId in cache) {
      const exports = cache[moduleId]?.exports;
      if (!exports || typeof exports !== 'object') continue;

      const keys = Object.keys(exports);
      let isTargetModule = false;

      for (const key of keys) {
        const val = exports[key];
        if (typeof val !== 'function') continue;
        try {
          const src = Function.prototype.toString.call(val);
          if (src.includes('rweb_client_transaction_id_enabled')) {
            isTargetModule = true;
            break;
          }
        } catch {
          // Some native functions throw on toString
        }
      }

      if (!isTargetModule) continue;

      // Found the module; look for the 3-arg generator function
      for (const key of keys) {
        const fn = exports[key];
        if (typeof fn === 'function' && fn.length === 3) {
          try {
            const candidate = fn as (
              host: string,
              path: string,
              method: string,
            ) => Promise<string>;
            const result = await candidate('x.com', path, method);
            // Valid transaction IDs are long base64-ish strings (~90+ chars)
            if (typeof result === 'string' && result.length > 20) {
              cachedTxGenerator = candidate;
              return result;
            }
          } catch {
            // Wrong function; continue searching
          }
        }
      }
    }

    throw new UpstreamError('Transaction ID generator module not found');
  } catch (err) {
    // Mutations (POST) require x-client-transaction-id; without it X rejects
    // them as misleading 344 "daily limit" errors. Surface the real failure
    // instead of silently sending a header-less request.
    if (method !== 'GET') {
      throw err instanceof Error
        ? err
        : new UpstreamError(
            `Could not generate x-client-transaction-id for ${method} ${path}`,
          );
    }
    // GETs can proceed without the header.
    return '';
  }
}

/**
 * Make an authenticated fetch to X's GraphQL API.
 */
async function xGraphQL<T>(
  operationName: string,
  variables: Record<string, unknown>,
  features: Record<string, boolean> = GRAPHQL_FEATURES,
  fieldToggles?: Record<string, boolean>,
): Promise<T> {
  const queryHash = await discoverQueryHash(operationName);
  const csrf = freshCsrf();
  const path = `/i/api/graphql/${queryHash}/${operationName}`;
  const txId = await generateTransactionId(path, 'GET');

  const queryParams: Record<string, string> = {
    variables: JSON.stringify(variables),
    features: JSON.stringify(features),
  };
  if (fieldToggles) {
    queryParams.fieldToggles = JSON.stringify(fieldToggles);
  }
  const params = new URLSearchParams(queryParams);

  const headers: Record<string, string> = {
    authorization: BEARER_TOKEN,
    'content-type': 'application/json',
    'x-csrf-token': csrf,
    'x-twitter-auth-type': 'OAuth2Session',
    'x-twitter-active-user': 'yes',
    'x-twitter-client-language': 'en',
  };
  if (txId) headers['x-client-transaction-id'] = txId;

  const response = await fetch(`https://x.com${path}?${params}`, {
    credentials: 'include',
    headers,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => undefined);
    throwForStatus(response.status, body);
  }

  return response.json() as Promise<T>;
}

/**
 * Make an authenticated POST mutation to X's GraphQL API.
 * Includes x-client-transaction-id header required for mutations.
 */
async function xGraphQLMutation<T>(
  operationName: string,
  variables: Record<string, unknown>,
  features?: Record<string, boolean>,
): Promise<T> {
  const queryHash = await discoverQueryHash(operationName);
  const csrf = freshCsrf();
  const path = `/i/api/graphql/${queryHash}/${operationName}`;
  const txId = await generateTransactionId(path, 'POST');

  const headers: Record<string, string> = {
    authorization: BEARER_TOKEN,
    'content-type': 'application/json',
    'x-csrf-token': csrf,
    'x-twitter-auth-type': 'OAuth2Session',
    'x-twitter-active-user': 'yes',
    'x-twitter-client-language': 'en',
  };
  if (txId) headers['x-client-transaction-id'] = txId;

  const body: Record<string, unknown> = {
    variables,
    queryId: queryHash,
  };
  if (features) body.features = features;

  const response = await fetch(`https://x.com${path}`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const respBody = await response.text().catch(() => undefined);
    throwForStatus(response.status, respBody);
  }

  return response.json() as Promise<T>;
}

/**
 * Normalize any X timestamp to an ISO 8601 string for consistent, readable
 * output. Handles X's legacy tweet/profile format ("Tue May 19 17:49:04 +0000
 * 2026"), epoch milliseconds, and epoch seconds. Returns '' for empty input and
 * falls back to the original value if it can't be parsed.
 */
function toIsoDate(value: string | number | undefined | null): string {
  if (value === undefined || value === null || value === '') return '';
  let date: Date;
  if (typeof value === 'number' || /^\d+$/.test(String(value))) {
    let n = Number(value);
    if (n < 1e12) n *= 1000; // epoch seconds -> milliseconds
    date = new Date(n);
  } else {
    date = new Date(String(value)); // X's legacy format parses natively
  }
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

/**
 * Twitter Snowflake IDs encode the creation time to the MILLISECOND — more
 * precise than the second-only `created_at` field. Returns ISO 8601, or null if
 * the id isn't a Snowflake (legacy pre-2010 ids). Twitter epoch = 1288834974657.
 */
function snowflakeToIso(id: string): string | null {
  if (!/^\d{8,}$/.test(id)) return null;
  try {
    const ms = Number((BigInt(id) >> 22n) + 1288834974657n);
    if (!Number.isFinite(ms) || ms < 1288834974657) return null;
    return new Date(ms).toISOString();
  } catch {
    return null;
  }
}

/**
 * Decode the HTML entities X escapes in user-facing text (tweet bodies, bios):
 * `&amp;` `&lt;` `&gt;` `&quot;` `&#39;`. `&amp;` is decoded last so genuinely
 * escaped sequences like "&amp;lt;" round-trip to "&lt;" rather than "<".
 */
function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Best available body text for a raw tweet result: prefer the longform
 * `note_tweet` body (legacy `full_text` is truncated for note tweets), else
 * `full_text`. Returns HTML-entity-decoded text.
 */
function tweetResultText(result: Record<string, unknown>): string {
  const legacy = result.legacy as Record<string, unknown> | undefined;
  const noteText = (
    result.note_tweet as
      | { note_tweet_results?: { result?: { text?: string } } }
      | undefined
  )?.note_tweet_results?.result?.text;
  return decodeEntities(noteText || (legacy?.full_text as string) || '');
}

/**
 * Parse a raw tweet result object into our Tweet schema.
 */
function parseTweet(result: Record<string, unknown>): Tweet | null {
  // CreateTweet responses omit __typename, so only reject non-Tweet types
  if (result.__typename && result.__typename !== 'Tweet') return null;

  const legacy = result.legacy as Record<string, unknown> | undefined;
  if (!legacy) return null;

  const tweetId =
    (result.rest_id as string) || (legacy.id_str as string) || '';
  const fullText = (legacy.full_text as string) || '';
  const isRetweet = fullText.startsWith('RT @');

  // Longform ("note") tweets store their full body in note_tweet; legacy
  // full_text is truncated for them. tweetResultText prefers the note body and
  // decodes the HTML entities X escapes (&amp; etc.).
  let text = tweetResultText(result);

  // Reposts: legacy.full_text is the truncated "RT @user: …" form (~140 chars),
  // so reposts of long/note posts get cut off. The real body lives in
  // retweeted_status_result — reconstruct the full "RT @author: <full text>".
  if (isRetweet) {
    let rt = (
      legacy.retweeted_status_result as
        | { result?: Record<string, unknown> }
        | undefined
    )?.result;
    if (
      rt &&
      rt.__typename === 'TweetWithVisibilityResults' &&
      rt.tweet
    ) {
      rt = rt.tweet as Record<string, unknown>;
    }
    if (rt) {
      const rtAuthor = (
        rt.core as
          | { user_results?: { result?: { core?: { screen_name?: string } } } }
          | undefined
      )?.user_results?.result?.core?.screen_name;
      const rtBody = tweetResultText(rt);
      if (rtAuthor && rtBody) text = `RT @${rtAuthor}: ${rtBody}`;
    }
  }

  // Extract author from core.user_results.result
  const core = result.core as
    | { user_results?: { result?: Record<string, unknown> } }
    | undefined;
  const authorData = core?.user_results?.result;
  const authorCore = authorData?.core as
    | { name?: string; screen_name?: string }
    | undefined;
  const authorAvatar = authorData?.avatar as { image_url?: string } | undefined;

  // Extract URLs from entities
  const entities = legacy.entities as
    | {
        urls?: Array<Record<string, string>>;
      }
    | undefined;

  const urls = entities?.urls?.map((u) => ({
    url: u.url || '',
    expandedUrl: u.expanded_url || '',
    displayUrl: u.display_url || '',
  }));

  // Media lives in extended_entities (entities.media omits video_info). For
  // video/gif, `url` should be the playable file, not the .jpg thumbnail — pick
  // the highest-bitrate mp4 variant and expose the still as thumbnailUrl.
  interface RawMedia {
    type?: string;
    media_url_https?: string;
    url?: string;
    video_info?: {
      variants?: Array<{ content_type?: string; url?: string; bitrate?: number }>;
    };
  }
  const extended = legacy.extended_entities as
    | { media?: RawMedia[] }
    | undefined;
  const rawMedia =
    extended?.media ?? (legacy.entities as { media?: RawMedia[] })?.media;

  const media = rawMedia?.map((m) => {
    const thumb = m.media_url_https || m.url || '';
    let url = thumb;
    if (m.type === 'video' || m.type === 'animated_gif') {
      const mp4 = (m.video_info?.variants ?? [])
        .filter((v) => v.content_type === 'video/mp4' && v.url)
        .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
      if (mp4?.url) url = mp4.url;
    }
    return {
      type: m.type || 'photo',
      url,
      ...(url !== thumb ? { thumbnailUrl: thumb } : {}),
    };
  });

  // Extract card (link preview or poll)
  const cardData = result.card as
    | {
        rest_id?: string;
        legacy?: {
          binding_values?: Array<{
            key: string;
            value: { string_value?: string };
          }>;
        };
      }
    | undefined;
  let card: Tweet['card'];
  if (cardData?.legacy?.binding_values || cardData?.rest_id) {
    const bindings = cardData?.legacy?.binding_values ?? [];
    const getBinding = (key: string) =>
      bindings.find((b) => b.key === key)?.value?.string_value;
    card = {
      // rest_id is the card URI (e.g. "card://123") identifying the card.
      uri: cardData?.rest_id,
      title: getBinding('title'),
      description: getBinding('description'),
      domain: getBinding('domain'),
      url: getBinding('card_url'),
    };
  }

  // Long-form Article: timelines carry the title + entity id on the seed post.
  // Surface it so callers know this post is an article and can read the body via
  // getArticle(thisPost.id).
  const articleResult = (
    result.article as
      | { article_results?: { result?: { rest_id?: string; title?: string } } }
      | undefined
  )?.article_results?.result;
  const article = articleResult
    ? {
        id: articleResult.rest_id || '',
        title: decodeEntities(articleResult.title || ''),
      }
    : undefined;

  // View count
  const views = result.views as { count?: string; state?: string } | undefined;
  const viewCount =
    views?.count !== undefined ? parseInt(views.count, 10) : undefined;

  const authorHandle = authorCore?.screen_name;
  return {
    id: tweetId,
    // Clickable permalink. Use the author handle when known; /i/status/<id>
    // resolves correctly even without it.
    url: authorHandle
      ? `https://x.com/${authorHandle}/status/${tweetId}`
      : `https://x.com/i/status/${tweetId}`,
    text,
    // Prefer the millisecond-precise time from the Snowflake id; fall back to
    // the second-precision created_at string for any non-Snowflake id.
    createdAt:
      snowflakeToIso(tweetId) ??
      toIsoDate(legacy.created_at as string | undefined),
    lang: legacy.lang as string | undefined,
    isRepost: isRetweet,
    isQuotePost: (legacy.is_quote_status as boolean) || false,
    viewCount: isNaN(viewCount as number) ? undefined : viewCount,
    repostCount: (legacy.retweet_count as number) || 0,
    likeCount: (legacy.favorite_count as number) || 0,
    replyCount: (legacy.reply_count as number) || 0,
    quoteCount: (legacy.quote_count as number) || 0,
    bookmarkCount: (legacy.bookmark_count as number) || 0,
    liked: (legacy.favorited as boolean) || false,
    reposted: (legacy.retweeted as boolean) || false,
    bookmarked: (legacy.bookmarked as boolean) || false,
    author: {
      id: (authorData?.rest_id as string) || '',
      name: authorCore?.name || '',
      screenName: authorCore?.screen_name || '',
      // Upgrade the 48px _normal avatar to 400px, matching parseUserProfile.
      profileImageUrl: authorAvatar?.image_url?.replace('_normal', '_400x400'),
      isBlueVerified: authorData?.is_blue_verified as boolean | undefined,
      // Badge kind (None=blue, Business=gold, Government=grey); read either the
      // top-level or nested `verification` position. See parseUserProfile.
      verifiedType:
        (authorData?.verified_type as string | undefined) ??
        (authorData?.verification as { verified_type?: string } | undefined)
          ?.verified_type,
    },
    urls: urls?.length ? urls : undefined,
    media: media?.length ? media : undefined,
    card,
    article,
  };
}

/**
 * Parse timeline instructions into posts + nextCursor.
 * Handles TweetWithVisibilityResults wrapping and cursor extraction.
 */
function parseTimelineInstructions(
  instructions: Array<{
    type: string;
    entries?: Array<{
      entryId: string;
      content: {
        entryType?: string;
        value?: string;
        itemContent?: {
          tweet_results?: {
            result?: Record<string, unknown>;
          };
        };
      };
    }>;
  }>,
): { posts: Tweet[]; nextCursor: string | undefined } {
  const posts: Tweet[] = [];
  let nextCursor: string | undefined;

  for (const instruction of instructions) {
    if (
      instruction.type !== 'TimelineAddEntries' &&
      instruction.type !== 'TimelineReplaceEntry'
    ) {
      continue;
    }

    for (const entry of instruction.entries || []) {
      const entryId = entry.entryId || '';

      if (entryId.startsWith('cursor-bottom-')) {
        nextCursor = entry.content?.value;
        continue;
      }

      if (!entryId.startsWith('tweet-')) continue;

      let tweetResult = entry.content?.itemContent?.tweet_results?.result;
      if (!tweetResult) continue;

      if (tweetResult.__typename === 'TweetWithVisibilityResults') {
        tweetResult = (tweetResult as Record<string, unknown>).tweet as
          | Record<string, unknown>
          | undefined;
        if (!tweetResult) continue;
      }

      const tweet = parseTweet(tweetResult);
      if (tweet) posts.push(tweet);
    }
  }

  return { posts, nextCursor };
}

/**
 * Parse timeline instructions whose entries are USERS (followers, following,
 * people search, likers, reposters) into profiles + nextCursor. User entries
 * have entryIds starting with `user-`; the profile sits at
 * itemContent.user_results.result and is parsed by the shared parseUserProfile.
 */
function parseUserTimelineInstructions(
  instructions: Array<{
    type: string;
    entries?: Array<{
      entryId: string;
      content: {
        entryType?: string;
        value?: string;
        itemContent?: {
          user_results?: { result?: Record<string, unknown> };
        };
      };
    }>;
  }>,
): { users: UserProfile[]; nextCursor: string | undefined } {
  const users: UserProfile[] = [];
  let nextCursor: string | undefined;

  for (const instruction of instructions) {
    if (
      instruction.type !== 'TimelineAddEntries' &&
      instruction.type !== 'TimelineReplaceEntry'
    ) {
      continue;
    }

    for (const entry of instruction.entries || []) {
      const entryId = entry.entryId || '';

      if (entryId.startsWith('cursor-bottom-')) {
        nextCursor = entry.content?.value;
        continue;
      }

      if (!entryId.startsWith('user-')) continue;

      const userResult = entry.content?.itemContent?.user_results?.result;
      if (!userResult) continue;

      users.push(parseUserProfile(userResult));
    }
  }

  return { users, nextCursor };
}

// ============================================================================
// Context
// ============================================================================

export function getContext(): GetContextOutput {
  const cookies = document.cookie.split(';');
  let csrf = '';
  let userId = '';

  for (const cookie of cookies) {
    const trimmed = cookie.trim();
    if (trimmed.startsWith('ct0=')) {
      csrf = trimmed.substring(4);
    }
    if (trimmed.startsWith('twid=')) {
      // twid cookie format: u%3D{userId} (URL-encoded "u={userId}")
      const decoded = decodeURIComponent(trimmed.substring(5));
      const match = decoded.match(/u=(\d+)/);
      if (match) userId = match[1];
    }
  }

  if (!csrf) {
    throw new Unauthenticated(
      `CSRF token (ct0 cookie) not found. URL: ${window.location.href}. Ensure you are logged into x.com.`,
    );
  }

  if (!userId) {
    throw new Unauthenticated(
      `User ID (twid cookie) not found. URL: ${window.location.href}. Ensure you are logged into x.com.`,
    );
  }

  return { csrf, userId };
}

/**
 * Read the authenticated user's id from the `twid` cookie, synchronously.
 * Internal helper: the exported `getContext` is wrapped by `__vallumWrap` into
 * an async function at build time, so library code cannot call it inline to get
 * a userId (it would read `.userId` off a Promise). Non-exported functions are
 * not wrapped, so this stays synchronous and usable internally.
 */
function authUserId(): string {
  for (const cookie of document.cookie.split(';')) {
    const trimmed = cookie.trim();
    if (trimmed.startsWith('twid=')) {
      const decoded = decodeURIComponent(trimmed.substring(5));
      const match = decoded.match(/u=(\d+)/);
      if (match) return match[1];
    }
  }
  throw new Unauthenticated(
    `User ID (twid cookie) not found. URL: ${window.location.href}. Ensure you are logged into x.com.`,
  );
}

// ============================================================================
// Posts
// ============================================================================

interface TimelineResponse {
  data: {
    user: {
      result: {
        timeline: {
          timeline: {
            instructions: Array<{
              type: string;
              entries?: Array<{
                entryId: string;
                content: {
                  entryType?: string;
                  value?: string;
                  itemContent?: {
                    tweet_results?: {
                      result?: Record<string, unknown>;
                    };
                  };
                };
              }>;
            }>;
          };
        };
      };
    };
  };
}

export async function listMyPosts(
  params: ListMyPostsInput,
): Promise<ListMyPostsOutput> {
  // This is the *authenticated* user's timeline; default to their own id so
  // callers can omit it. X throws an opaque GRAPHQL_VALIDATION_FAILED
  // ("variable userId must be defined") if it ends up undefined.
  const userId = params.userId ?? authUserId();
  const variables: Record<string, unknown> = {
    userId,
    count: params.count,
    includePromotedContent: false,
    withQuickPromoteEligibilityTweetFields: true,
    withVoice: true,
  };

  if (params.cursor) {
    variables.cursor = params.cursor;
  }

  const data = await xGraphQL<TimelineResponse>(
    'UserTweets',
    variables,
    GRAPHQL_FEATURES,
    { withArticlePlainText: false },
  );

  const posts: Tweet[] = [];
  let nextCursor: string | undefined;

  const instructions =
    data.data?.user?.result?.timeline?.timeline?.instructions || [];

  for (const instruction of instructions) {
    if (
      instruction.type !== 'TimelineAddEntries' &&
      instruction.type !== 'TimelineReplaceEntry'
    ) {
      continue;
    }

    for (const entry of instruction.entries || []) {
      const entryId = entry.entryId || '';

      // Extract cursor for pagination
      if (entryId.startsWith('cursor-bottom-')) {
        nextCursor = entry.content?.value;
        continue;
      }

      // Skip non-tweet entries
      if (!entryId.startsWith('tweet-')) continue;

      const tweetResult = entry.content?.itemContent?.tweet_results?.result;
      if (!tweetResult) continue;

      const tweet = parseTweet(tweetResult);
      if (tweet) posts.push(tweet);
    }
  }

  return { posts, nextCursor };
}

// ============================================================================
// Create Post
// ============================================================================

// Feature flags for the CreateTweet mutation (subset of query features).
const CREATE_TWEET_FEATURES: Record<string, boolean> = {
  premium_content_api_read_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: true,
  responsive_web_jetfuel_frame: true,
  responsive_web_grok_share_attachment_enabled: true,
  responsive_web_grok_annotations_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  responsive_web_grok_show_grok_translated_post: true,
  responsive_web_grok_analysis_button_from_backend: true,
  post_ctas_fetch_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_profile_redirect_enabled: false,
  rweb_tipjar_consumption_enabled: false,
  verified_phone_label_enabled: false,
  articles_preview_enabled: true,
  responsive_web_grok_community_note_auto_translation_is_enabled: false,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_grok_imagine_annotation_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_enhance_cards_enabled: false,
};

interface CreateTweetResponse {
  data: {
    create_tweet?: {
      tweet_results: {
        result: Record<string, unknown>;
      };
    };
  };
  errors?: Array<{ message: string; code?: number }>;
}

const REPLY_RESTRICTION_MAP: Record<string, string> = {
  following: 'Community',
  verified: 'Verified',
  mentionedOnly: 'ByInvitation',
};

/**
 * Upload a base64 image to X's media endpoint via the INIT/APPEND/FINALIZE
 * chunked flow and return its media_id. `category` selects the upload bucket
 * ('tweet_image' for posts, 'dm_image' for DMs).
 */
async function uploadMedia(
  imageBase64: string,
  mimeType: string,
  category: string,
): Promise<string> {
  const csrf = freshCsrf();
  const totalBytes = atob(imageBase64).length;
  const authHeaders: Record<string, string> = {
    authorization: BEARER_TOKEN,
    'x-csrf-token': csrf,
    'x-twitter-auth-type': 'OAuth2Session',
  };

  const initBody = new URLSearchParams();
  initBody.append('command', 'INIT');
  initBody.append('total_bytes', totalBytes.toString());
  initBody.append('media_type', mimeType);
  initBody.append('media_category', category);

  const initResp = await fetch('https://upload.x.com/1.1/media/upload.json', {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders,
    body: initBody,
  });
  if (!initResp.ok) {
    throwForStatus(initResp.status, await initResp.text().catch(() => undefined));
  }
  const mediaId = ((await initResp.json()) as { media_id_string: string })
    .media_id_string;

  const appendForm = new FormData();
  appendForm.append('command', 'APPEND');
  appendForm.append('media_id', mediaId);
  appendForm.append('segment_index', '0');
  appendForm.append('media_data', imageBase64);
  const appendResp = await fetch('https://upload.x.com/1.1/media/upload.json', {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders,
    body: appendForm,
  });
  if (!appendResp.ok) {
    throwForStatus(appendResp.status, await appendResp.text().catch(() => undefined));
  }

  const finalizeBody = new URLSearchParams();
  finalizeBody.append('command', 'FINALIZE');
  finalizeBody.append('media_id', mediaId);
  const finalizeResp = await fetch('https://upload.x.com/1.1/media/upload.json', {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders,
    body: finalizeBody,
  });
  if (!finalizeResp.ok) {
    throwForStatus(finalizeResp.status, await finalizeResp.text().catch(() => undefined));
  }

  return mediaId;
}

export async function createPost(
  params: CreatePostInput,
): Promise<CreatePostOutput> {
  // Upload any attached images first, then reference their media_ids.
  const mediaEntities: Array<{ media_id: string; tagged_users: string[] }> = [];
  for (const img of params.images ?? []) {
    const mediaId = await uploadMedia(img.base64, img.mimeType, 'tweet_image');
    mediaEntities.push({ media_id: mediaId, tagged_users: [] });
  }

  const variables: Record<string, unknown> = {
    tweet_text: params.text,
    dark_request: false,
    media: {
      media_entities: mediaEntities,
      possibly_sensitive: false,
    },
    semantic_annotation_ids: [],
  };

  if (params.replyToTweetId) {
    variables.reply = {
      in_reply_to_tweet_id: params.replyToTweetId,
      exclude_reply_user_ids: [],
    };
  }

  if (params.quoteTweetId) {
    if (!params.quoteTweetAuthor) {
      throw new Validation('quoteTweetAuthor is required when quoteTweetId is set');
    }
    variables.attachment_url = `https://x.com/${params.quoteTweetAuthor}/status/${params.quoteTweetId}`;
  }

  if (params.replyRestriction) {
    variables.conversation_control = {
      mode: REPLY_RESTRICTION_MAP[params.replyRestriction],
    };
  }

  const data = await xGraphQLMutation<CreateTweetResponse>(
    'CreateTweet',
    variables,
    CREATE_TWEET_FEATURES,
  );

  if (data.errors?.length) {
    throw new UpstreamError(`CreateTweet failed: ${data.errors[0].message}`);
  }

  const tweetResult = data.data?.create_tweet?.tweet_results?.result;
  if (!tweetResult) {
    throw new ContractDrift(
      `CreateTweet returned no tweet data. Response: ${JSON.stringify(data.data)}`,
    );
  }

  const tweet = parseTweet(tweetResult);
  if (!tweet) {
    throw new ContractDrift('Failed to parse created tweet from response');
  }

  return { post: tweet };
}

// ============================================================================
// Create Poll Post
// ============================================================================

interface CreateCardResponse {
  card_uri: string;
}

export async function createPollPost(
  params: CreatePollPostInput,
): Promise<CreatePollPostOutput> {
  const choiceCount = params.choices.length;
  if (choiceCount < 2 || choiceCount > 4) {
    throw new Validation(`Poll requires 2–4 choices, got ${choiceCount}`);
  }

  const csrf = freshCsrf();
  const cardType = `poll${choiceCount}choice_text_only`;

  const cardData: Record<string, string> = {
    'twitter:card': cardType,
    'twitter:api:api:endpoint': '1',
    'twitter:long:duration_minutes': String(params.durationMinutes ?? 1440),
  };

  params.choices.forEach((choice, i) => {
    cardData[`twitter:string:choice${i + 1}_label`] = choice;
  });

  const formBody = `card_data=${encodeURIComponent(JSON.stringify(cardData))}`;

  const cardResponse = await fetch('https://caps.x.com/v2/cards/create.json', {
    method: 'POST',
    credentials: 'include',
    headers: {
      authorization: BEARER_TOKEN,
      'content-type': 'application/x-www-form-urlencoded',
      'x-csrf-token': csrf,
      'x-twitter-auth-type': 'OAuth2Session',
      'x-twitter-active-user': 'yes',
      'x-twitter-client-language': 'en',
    },
    body: formBody,
  });

  if (!cardResponse.ok) {
    const body = await cardResponse.text().catch(() => undefined);
    throwForStatus(cardResponse.status, body);
  }

  const cardResult = (await cardResponse.json()) as CreateCardResponse;
  const cardUri = cardResult.card_uri;
  if (!cardUri) {
    throw new ContractDrift('Poll card creation returned no card_uri');
  }

  const variables: Record<string, unknown> = {
    tweet_text: params.text,
    dark_request: false,
    media: {
      media_entities: [],
      possibly_sensitive: false,
    },
    semantic_annotation_ids: [],
    card_uri: cardUri,
  };

  const data = await xGraphQLMutation<CreateTweetResponse>(
    'CreateTweet',
    variables,
    CREATE_TWEET_FEATURES,
  );

  if (data.errors?.length) {
    throw new UpstreamError(`CreateTweet (poll) failed: ${data.errors[0].message}`);
  }

  const tweetResult = data.data?.create_tweet?.tweet_results?.result;
  if (!tweetResult) {
    throw new ContractDrift(
      `CreateTweet (poll) returned no tweet data. Response: ${JSON.stringify(data.data)}`,
    );
  }

  const tweet = parseTweet(tweetResult);
  if (!tweet) {
    throw new ContractDrift('Failed to parse created poll tweet from response');
  }

  return { post: tweet };
}

// ============================================================================
// Scheduled Posts
// ============================================================================

interface CreateScheduledTweetResponse {
  data: {
    tweet: {
      rest_id: string;
    };
  };
  errors?: Array<{ message: string; code?: number }>;
}

interface FetchScheduledTweetsResponse {
  data: {
    viewer: {
      scheduled_tweet_list: Array<{
        rest_id: string;
        scheduling_info: {
          execute_at: number;
          state: string;
        };
        tweet_create_request: {
          status: string;
          media_ids: string[];
          type: string;
        };
      }>;
    };
  };
}

interface DeleteScheduledTweetResponse {
  data: {
    scheduledtweet_delete: string;
  };
  errors?: Array<{ message: string; code?: number }>;
}

export async function createScheduledPost(
  params: CreateScheduledPostInput,
): Promise<CreateScheduledPostOutput> {
  const executeAt = Math.floor(new Date(params.scheduledAt).getTime() / 1000);

  if (isNaN(executeAt)) {
    throw new Validation(
      `Invalid scheduledAt value: "${params.scheduledAt}". Must be a valid ISO 8601 datetime string.`,
    );
  }

  const variables: Record<string, unknown> = {
    post_tweet_request: {
      auto_populate_reply_metadata: false,
      status: params.text,
      exclude_reply_user_ids: [],
      media_ids: [],
      thread_tweets: [],
    },
    execute_at: executeAt,
  };

  const data = await xGraphQLMutation<CreateScheduledTweetResponse>(
    'CreateScheduledTweet',
    variables,
  );

  if (data.errors?.length) {
    throw new UpstreamError(`CreateScheduledTweet failed: ${data.errors[0].message}`);
  }

  const scheduledPostId = data.data?.tweet?.rest_id;
  if (!scheduledPostId) {
    throw new ContractDrift(
      `CreateScheduledTweet returned no ID. Response: ${JSON.stringify(data.data)}`,
    );
  }

  return { scheduledPostId };
}

export async function listScheduledPosts(
  _params: ListScheduledPostsInput,
): Promise<ListScheduledPostsOutput> {
  const data = await xGraphQL<FetchScheduledTweetsResponse>(
    'FetchScheduledTweets',
    { ascending: true },
    {},
  );

  const rawList = data.data?.viewer?.scheduled_tweet_list;
  if (!rawList) {
    throw new ContractDrift(
      `FetchScheduledTweets returned no scheduled_tweet_list. Response: ${JSON.stringify(data.data)}`,
    );
  }

  const scheduledPosts = rawList.map((item) => {
    const text = item.tweet_create_request?.status;
    if (text === undefined) {
      throw new ContractDrift(
        `Scheduled post ${item.rest_id} is missing tweet_create_request.status`,
      );
    }
    return {
      id: item.rest_id,
      text,
      // X's API is asymmetric: CreateScheduledTweet accepts execute_at in epoch
      // SECONDS (see createScheduledPost), but FetchScheduledTweets returns it in
      // epoch MILLISECONDS. Verified live: a 2026-09 schedule round-trips as
      // ~1.787e12. Do NOT multiply by 1000 (that yields year 58638).
      scheduledAt: new Date(item.scheduling_info.execute_at).toISOString(),
      state: item.scheduling_info.state,
    };
  });

  return { scheduledPosts };
}

export async function deleteScheduledPost(
  params: DeleteScheduledPostInput,
): Promise<DeleteScheduledPostOutput> {
  const data = await xGraphQLMutation<DeleteScheduledTweetResponse>(
    'DeleteScheduledTweet',
    { scheduled_tweet_id: params.scheduledPostId },
  );

  if (data.errors?.length) {
    throw new UpstreamError(`DeleteScheduledTweet failed: ${data.errors[0].message}`);
  }

  return { success: data.data?.scheduledtweet_delete === 'Done' };
}

// ============================================================================
// Search
// ============================================================================

interface SearchTimelineResponse {
  data: {
    search_by_raw_query: {
      search_timeline: {
        timeline: {
          instructions: Array<{
            type: string;
            entries?: Array<{
              entryId: string;
              content: {
                entryType?: string;
                value?: string;
                itemContent?: {
                  tweet_results?: {
                    result?: Record<string, unknown>;
                  };
                };
              };
            }>;
          }>;
        };
      };
    };
  };
}

export async function searchPosts(
  params: SearchPostsInput,
): Promise<SearchPostsOutput> {
  const variables: Record<string, unknown> = {
    rawQuery: params.query,
    count: params.count ?? 20,
    querySource: 'typed_query',
    product: params.product ?? 'Top',
    withGrokTranslatedBio: false,
  };

  if (params.cursor) {
    variables.cursor = params.cursor;
  }

  const data = await xGraphQL<SearchTimelineResponse>(
    'SearchTimeline',
    variables,
  );

  const posts: Tweet[] = [];
  let nextCursor: string | undefined;

  const instructions =
    data.data?.search_by_raw_query?.search_timeline?.timeline?.instructions ||
    [];

  for (const instruction of instructions) {
    if (instruction.type !== 'TimelineAddEntries') continue;

    for (const entry of instruction.entries || []) {
      const entryId = entry.entryId || '';

      if (entryId.startsWith('cursor-bottom')) {
        nextCursor = entry.content?.value;
        continue;
      }

      if (!entryId.startsWith('tweet-')) continue;

      const tweetResult = entry.content?.itemContent?.tweet_results?.result;
      if (!tweetResult) continue;

      const tweet = parseTweet(tweetResult);
      if (tweet) posts.push(tweet);
    }
  }

  return { posts, nextCursor };
}

// ============================================================================
// Like
// ============================================================================

interface FavoriteTweetResponse {
  data: {
    favorite_tweet?: string;
  };
  errors?: Array<{ message: string; code?: number }>;
}

export async function likePost(params: LikePostInput): Promise<LikePostOutput> {
  const data = await xGraphQLMutation<FavoriteTweetResponse>('FavoriteTweet', {
    tweet_id: params.tweetId,
  });

  if (data.errors?.length) {
    throw new UpstreamError(`FavoriteTweet failed: ${data.errors[0].message}`);
  }

  return { success: data.data?.favorite_tweet === 'Done' };
}

// ============================================================================
// Repost
// ============================================================================

interface CreateRetweetResponse {
  data: {
    create_retweet?: {
      retweet_results: {
        result: {
          rest_id: string;
        };
      };
    };
  };
  errors?: Array<{ message: string; code?: number }>;
}

export async function createRepost(
  params: CreateRepostInput,
): Promise<CreateRepostOutput> {
  const data = await xGraphQLMutation<CreateRetweetResponse>('CreateRetweet', {
    tweet_id: params.tweetId,
    dark_request: false,
  });

  if (data.errors?.length) {
    throw new UpstreamError(`CreateRetweet failed: ${data.errors[0].message}`);
  }

  const retweetId = data.data?.create_retweet?.retweet_results?.result?.rest_id;
  if (!retweetId) {
    throw new ContractDrift(
      `CreateRetweet returned no retweet ID. Response: ${JSON.stringify(data.data)}`,
    );
  }

  return { retweetId };
}

// ============================================================================
// Profile
// ============================================================================

const PROFILE_FEATURES: Record<string, boolean> = {
  hidden_profile_subscriptions_enabled: true,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_profile_redirect_enabled: false,
  rweb_tipjar_consumption_enabled: false,
  verified_phone_label_enabled: false,
  subscriptions_verification_info_is_identity_verified_enabled: true,
  subscriptions_verification_info_verified_since_enabled: true,
  highlights_tweets_tab_ui_enabled: true,
  responsive_web_twitter_article_notes_tab_enabled: true,
  subscriptions_feature_can_gift_premium: true,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  responsive_web_graphql_timeline_navigation_enabled: true,
};

interface UserByScreenNameResponse {
  data: {
    user: {
      result: Record<string, unknown>;
    };
  };
}

function parseUserProfile(result: Record<string, unknown>): UserProfile {
  const core = result.core as
    | { created_at?: string; name?: string; screen_name?: string }
    | undefined;
  const legacy = result.legacy as Record<string, unknown> | undefined;
  const avatar = result.avatar as { image_url?: string } | undefined;
  const location = result.location as { location?: string } | undefined;
  const privacy = result.privacy as { protected?: boolean } | undefined;
  const relationship = result.relationship_perspectives as
    | { following?: boolean }
    | undefined;

  // Extract expanded URL from entities
  const entities = legacy?.entities as
    | { url?: { urls?: Array<{ expanded_url?: string }> } }
    | undefined;
  const expandedUrl = entities?.url?.urls?.[0]?.expanded_url;

  // Verification / tier signals. X has shuffled these between a top-level
  // position and a nested `verification` object across deploys, so read both.
  // verified_type sets the badge COLOUR (None=blue, Business=gold,
  // Government=grey); it does NOT reveal Premium vs Premium+ — no public field
  // does (see schemas.ts). All optional: absent paths simply stay undefined.
  const verification = result.verification as
    | { verified_type?: string; is_identity_verified?: boolean }
    | undefined;
  const verifiedType =
    (result.verified_type as string | undefined) ?? verification?.verified_type;
  const isIdentityVerified =
    (result.is_identity_verified as boolean | undefined) ??
    verification?.is_identity_verified;

  // Affiliation to a Verified Organization (employee / sub-account badge).
  const affiliate = result.affiliates_highlighted_label as
    | { label?: { description?: string; badge?: { url?: string } } }
    | undefined;
  const affiliateLabel = affiliate?.label
    ? {
        description: affiliate.label.description,
        badgeUrl: affiliate.label.badge?.url,
      }
    : undefined;

  const handle = core?.screen_name || '';
  return {
    id: (result.rest_id as string) || '',
    name: core?.name || '',
    screenName: handle,
    profileUrl: handle
      ? `https://x.com/${handle}`
      : `https://x.com/i/user/${(result.rest_id as string) || ''}`,
    description: decodeEntities((legacy?.description as string) || ''),
    location: location?.location || undefined,
    url: expandedUrl || undefined,
    profileImageUrl: avatar?.image_url?.replace('_normal', '_400x400'),
    profileBannerUrl: legacy?.profile_banner_url as string | undefined,
    isBlueVerified: (result.is_blue_verified as boolean) || false,
    verifiedType,
    isIdentityVerified,
    affiliateLabel,
    isProtected: privacy?.protected || false,
    followersCount: (legacy?.followers_count as number) || 0,
    followingCount: (legacy?.friends_count as number) || 0,
    statusesCount: (legacy?.statuses_count as number) || 0,
    likesCount: (legacy?.favourites_count as number) || 0,
    listedCount: (legacy?.listed_count as number) || 0,
    mediaCount: (legacy?.media_count as number) || 0,
    createdAt: toIsoDate(core?.created_at),
    pinnedTweetIds: (legacy?.pinned_tweet_ids_str as string[]) || [],
    isFollowing: relationship?.following || false,
  };
}

export async function getProfile(
  params: GetProfileInput,
): Promise<GetProfileOutput> {
  const data = await xGraphQL<UserByScreenNameResponse>(
    'UserByScreenName',
    { screen_name: params.screenName, withGrokTranslatedBio: false },
    PROFILE_FEATURES,
  );

  const userResult = data.data?.user?.result;
  if (!userResult) {
    throw new NotFound(
      `User @${params.screenName} not found. Response: ${JSON.stringify(data.data)}`,
    );
  }

  return { profile: parseUserProfile(userResult) };
}

// ============================================================================
// Follow / Unfollow (REST API v1.1)
// ============================================================================

const FRIENDSHIP_PARAMS = new URLSearchParams({
  include_profile_interstitial_type: '1',
  include_blocking: '1',
  include_blocked_by: '1',
  include_followed_by: '1',
  include_want_retweets: '1',
  include_mute_edge: '1',
  include_can_dm: '1',
  include_can_media_tag: '1',
  include_ext_is_blue_verified: '1',
  include_ext_verified_type: '1',
  include_ext_profile_image_shape: '1',
  skip_status: '1',
});

async function xRestPost<T>(
  path: string,
  body: URLSearchParams | Record<string, unknown>,
): Promise<T> {
  const csrf = freshCsrf();
  const txId = await generateTransactionId(path, 'POST');

  const isJson = !(body instanceof URLSearchParams);
  const headers: Record<string, string> = {
    authorization: BEARER_TOKEN,
    'content-type': isJson
      ? 'application/json'
      : 'application/x-www-form-urlencoded',
    'x-csrf-token': csrf,
    'x-twitter-auth-type': 'OAuth2Session',
    'x-twitter-active-user': 'yes',
    'x-twitter-client-language': 'en',
  };
  if (txId) headers['x-client-transaction-id'] = txId;

  const response = await fetch(`https://api.x.com${path}`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: isJson ? JSON.stringify(body) : body.toString(),
  });

  if (!response.ok) {
    const respBody = await response.text().catch(() => undefined);
    throwForStatus(response.status, respBody);
  }

  return response.json() as Promise<T>;
}

/**
 * POST to x.com domain (not api.x.com). Used for endpoints that
 * haven't migrated to api.x.com (e.g. account/multi/switch).
 */
async function xDomainPost<T>(path: string, body: URLSearchParams): Promise<T> {
  const csrf = freshCsrf();

  const headers: Record<string, string> = {
    authorization: BEARER_TOKEN,
    'content-type': 'application/x-www-form-urlencoded',
    'x-csrf-token': csrf,
    'x-twitter-auth-type': 'OAuth2Session',
    'x-twitter-active-user': 'yes',
    'x-twitter-client-language': 'en',
  };

  const response = await fetch(`https://x.com${path}`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: body.toString(),
  });

  if (!response.ok) {
    const respBody = await response.text().catch(() => undefined);
    throwForStatus(response.status, respBody);
  }

  return response.json() as Promise<T>;
}

async function xRestGet<T>(path: string, params: URLSearchParams): Promise<T> {
  const csrf = freshCsrf();

  const headers: Record<string, string> = {
    authorization: BEARER_TOKEN,
    'content-type': 'application/json',
    'x-csrf-token': csrf,
    'x-twitter-auth-type': 'OAuth2Session',
    'x-twitter-active-user': 'yes',
    'x-twitter-client-language': 'en',
  };

  const response = await fetch(`https://api.x.com${path}?${params}`, {
    method: 'GET',
    credentials: 'include',
    headers,
  });

  if (!response.ok) {
    const respBody = await response.text().catch(() => undefined);
    throwForStatus(response.status, respBody);
  }

  return response.json() as Promise<T>;
}

/**
 * DELETE request to api.x.com with empty response handling.
 */
async function xRestDelete(path: string): Promise<void> {
  // This is a write path (despite the POST verb) that does not go through
  // generateTransactionId, so jitter it directly. See mutationJitter.
  await mutationJitter();
  const csrf = freshCsrf();

  const headers: Record<string, string> = {
    authorization: BEARER_TOKEN,
    'content-type': 'application/json',
    'x-csrf-token': csrf,
    'x-twitter-auth-type': 'OAuth2Session',
    'x-twitter-active-user': 'yes',
    'x-twitter-client-language': 'en',
  };

  const response = await fetch(`https://api.x.com${path}`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({}),
  });

  if (!response.ok && response.status !== 204) {
    const respBody = await response.text().catch(() => undefined);
    throwForStatus(response.status, respBody);
  }
}

interface FriendshipResponse {
  id_str: string;
  name: string;
  screen_name: string;
}

export async function followUser(
  params: FollowUserInput,
): Promise<FollowUserOutput> {
  const body = new URLSearchParams(FRIENDSHIP_PARAMS);
  body.set('user_id', params.userId);

  const data = await xRestPost<FriendshipResponse>(
    '/1.1/friendships/create.json',
    body,
  );

  return {
    success: true,
    user: {
      id: data.id_str,
      name: data.name,
      screenName: data.screen_name,
    },
  };
}

export async function unfollowUser(
  params: UnfollowUserInput,
): Promise<UnfollowUserOutput> {
  const body = new URLSearchParams(FRIENDSHIP_PARAMS);
  body.set('user_id', params.userId);

  await xRestPost<FriendshipResponse>('/1.1/friendships/destroy.json', body);

  return { success: true };
}

// ============================================================================
// Unlike Post
// ============================================================================

interface UnfavoriteTweetResponse {
  data: {
    unfavorite_tweet?: string;
  };
  errors?: Array<{ message: string; code?: number }>;
}

export async function unlikePost(
  params: UnlikePostInput,
): Promise<UnlikePostOutput> {
  const data = await xGraphQLMutation<UnfavoriteTweetResponse>(
    'UnfavoriteTweet',
    { tweet_id: params.tweetId },
  );

  if (data.errors?.length) {
    throw new UpstreamError(`UnfavoriteTweet failed: ${data.errors[0].message}`);
  }

  return { success: data.data?.unfavorite_tweet === 'Done' };
}

// ============================================================================
// Delete Post
// ============================================================================

interface DeleteTweetResponse {
  data: {
    delete_tweet?: {
      tweet_results: Record<string, unknown>;
    };
  };
  errors?: Array<{ message: string; code?: number }>;
}

export async function deletePost(
  params: DeletePostInput,
): Promise<DeletePostOutput> {
  const data = await xGraphQLMutation<DeleteTweetResponse>('DeleteTweet', {
    tweet_id: params.tweetId,
    dark_request: false,
  });

  if (data.errors?.length) {
    throw new UpstreamError(`DeleteTweet failed: ${data.errors[0].message}`);
  }

  if (!data.data?.delete_tweet) {
    throw new ContractDrift(
      `DeleteTweet returned no confirmation. Response: ${JSON.stringify(data.data)}`,
    );
  }

  return { success: true };
}

// ============================================================================
// Delete Repost
// ============================================================================

interface DeleteRetweetResponse {
  data: {
    unretweet?: {
      source_tweet_results: {
        result: {
          rest_id: string;
        };
      };
    };
  };
  errors?: Array<{ message: string; code?: number }>;
}

export async function deleteRepost(
  params: DeleteRepostInput,
): Promise<DeleteRepostOutput> {
  const data = await xGraphQLMutation<DeleteRetweetResponse>('DeleteRetweet', {
    source_tweet_id: params.tweetId,
  });

  if (data.errors?.length) {
    throw new UpstreamError(`DeleteRetweet failed: ${data.errors[0].message}`);
  }

  if (!data.data?.unretweet) {
    throw new ContractDrift(
      `DeleteRetweet returned no confirmation. Response: ${JSON.stringify(data.data)}`,
    );
  }

  return { success: true };
}

// ============================================================================
// Bookmark
// ============================================================================

interface BookmarkTweetResponse {
  data: {
    tweet_bookmark_put?: string;
  };
  errors?: Array<{ message: string; code?: number }>;
}

export async function bookmarkPost(
  params: BookmarkPostInput,
): Promise<BookmarkPostOutput> {
  const data = await xGraphQLMutation<BookmarkTweetResponse>('CreateBookmark', {
    tweet_id: params.tweetId,
  });

  if (data.errors?.length) {
    throw new UpstreamError(`CreateBookmark failed: ${data.errors[0].message}`);
  }

  return {
    success: data.data?.tweet_bookmark_put === 'Done',
  };
}

// ============================================================================
// Unbookmark
// ============================================================================

interface DeleteBookmarkResponse {
  data: {
    tweet_bookmark_delete?: string;
  };
  errors?: Array<{ message: string; code?: number }>;
}

export async function unbookmarkPost(
  params: UnbookmarkPostInput,
): Promise<UnbookmarkPostOutput> {
  const data = await xGraphQLMutation<DeleteBookmarkResponse>(
    'DeleteBookmark',
    { tweet_id: params.tweetId },
  );

  if (data.errors?.length) {
    throw new UpstreamError(`DeleteBookmark failed: ${data.errors[0].message}`);
  }

  return {
    success: data.data?.tweet_bookmark_delete === 'Done',
  };
}

// ============================================================================
// List Bookmarks
// ============================================================================

interface BookmarkTimelineResponse {
  data: {
    bookmark_timeline_v2: {
      timeline: {
        instructions: Array<{
          type: string;
          entries?: Array<{
            entryId: string;
            content: {
              entryType?: string;
              value?: string;
              itemContent?: {
                tweet_results?: {
                  result?: Record<string, unknown>;
                };
              };
            };
          }>;
        }>;
      };
    };
  };
}

export async function listBookmarks(
  params: ListBookmarksInput,
): Promise<ListBookmarksOutput> {
  const variables: Record<string, unknown> = {
    count: params.count ?? 20,
    includePromotedContent: false,
  };

  if (params.cursor) {
    variables.cursor = params.cursor;
  }

  const data = await xGraphQL<BookmarkTimelineResponse>(
    'Bookmarks',
    variables,
    GRAPHQL_FEATURES,
  );

  const posts: Tweet[] = [];
  let nextCursor: string | undefined;

  const instructions =
    data.data?.bookmark_timeline_v2?.timeline?.instructions || [];

  for (const instruction of instructions) {
    if (instruction.type !== 'TimelineAddEntries') continue;

    for (const entry of instruction.entries || []) {
      const entryId = entry.entryId;
      if (!entryId) continue;

      if (entryId.startsWith('cursor-bottom')) {
        nextCursor = entry.content?.value;
        continue;
      }

      if (!entryId.startsWith('tweet-')) continue;

      let tweetResult = entry.content?.itemContent?.tweet_results?.result;
      if (!tweetResult) continue;

      // Unwrap TweetWithVisibilityResults if present
      if (
        tweetResult.__typename === 'TweetWithVisibilityResults' &&
        tweetResult.tweet
      ) {
        tweetResult = tweetResult.tweet as Record<string, unknown>;
      }

      const tweet = parseTweet(tweetResult);
      if (tweet) posts.push(tweet);
    }
  }

  return { posts, nextCursor };
}

// ============================================================================
// For You Timeline
// ============================================================================

interface HomeTimelineResponse {
  data: {
    home: {
      home_timeline_urt: {
        instructions: Array<{
          type: string;
          entries?: Array<{
            entryId: string;
            content: {
              entryType?: string;
              value?: string;
              itemContent?: {
                tweet_results?: {
                  result?: Record<string, unknown>;
                };
              };
            };
          }>;
        }>;
      };
    };
  };
}

export async function getForYouTimeline(
  params: GetForYouTimelineInput,
): Promise<GetForYouTimelineOutput> {
  const variables: Record<string, unknown> = {
    count: params.count ?? 20,
    includePromotedContent: true,
    latestControlAvailable: true,
    requestContext: 'launch',
  };

  if (params.cursor) {
    variables.cursor = params.cursor;
  }

  const data = await xGraphQL<HomeTimelineResponse>(
    'HomeTimeline',
    variables,
    GRAPHQL_FEATURES,
    { withArticlePlainText: false },
  );

  const instructions = data.data?.home?.home_timeline_urt?.instructions || [];

  return parseTimelineInstructions(instructions);
}

// ============================================================================
// Following Timeline
// ============================================================================

export async function getFollowingTimeline(
  params: GetFollowingTimelineInput,
): Promise<GetFollowingTimelineOutput> {
  const variables: Record<string, unknown> = {
    count: params.count ?? 20,
    includePromotedContent: true,
    latestControlAvailable: true,
    requestContext: 'launch',
  };

  if (params.cursor) {
    variables.cursor = params.cursor;
  }

  const data = await xGraphQL<HomeTimelineResponse>(
    'HomeLatestTimeline',
    variables,
    GRAPHQL_FEATURES,
    { withArticlePlainText: false },
  );

  const instructions = data.data?.home?.home_timeline_urt?.instructions || [];

  return parseTimelineInstructions(instructions);
}

// ============================================================================
// Get User Posts
// ============================================================================

interface UserTimelineV2Response {
  data: {
    user: {
      result: {
        timeline: {
          timeline: {
            instructions: Array<{
              type: string;
              entries?: Array<{
                entryId: string;
                content: {
                  entryType?: string;
                  value?: string;
                  itemContent?: {
                    tweet_results?: {
                      result?: Record<string, unknown>;
                    };
                  };
                };
              }>;
            }>;
          };
        };
      };
    };
  };
}

export async function getUserPosts(
  params: GetUserPostsInput,
): Promise<GetUserPostsOutput> {
  const variables: Record<string, unknown> = {
    userId: params.userId,
    count: params.count ?? 20,
    includePromotedContent: false,
    withQuickPromoteEligibilityTweetFields: true,
    withVoice: true,
  };

  if (params.cursor) {
    variables.cursor = params.cursor;
  }

  const data = await xGraphQL<UserTimelineV2Response>(
    'UserTweets',
    variables,
    GRAPHQL_FEATURES,
    { withArticlePlainText: false },
  );

  const instructions =
    data.data?.user?.result?.timeline?.timeline?.instructions || [];

  return parseTimelineInstructions(instructions);
}

// ============================================================================
// Get User Replies
// ============================================================================

export async function getUserReplies(
  params: GetUserRepliesInput,
): Promise<GetUserRepliesOutput> {
  const variables: Record<string, unknown> = {
    userId: params.userId,
    count: params.count ?? 20,
    includePromotedContent: false,
    withQuickPromoteEligibilityTweetFields: true,
    withVoice: true,
  };

  if (params.cursor) {
    variables.cursor = params.cursor;
  }

  const data = await xGraphQL<UserTimelineV2Response>(
    'UserTweetsAndReplies',
    variables,
    GRAPHQL_FEATURES,
    { withArticlePlainText: false },
  );

  const instructions =
    data.data?.user?.result?.timeline?.timeline?.instructions || [];

  return parseTimelineInstructions(instructions);
}

// ============================================================================
// Get User Likes
// ============================================================================

interface LikesTimelineResponse {
  data: {
    user: {
      result: {
        timeline: {
          timeline: {
            instructions: Array<{
              type: string;
              entries?: Array<{
                entryId: string;
                content: {
                  entryType?: string;
                  value?: string;
                  itemContent?: {
                    tweet_results?: {
                      result?: Record<string, unknown>;
                    };
                  };
                };
              }>;
            }>;
          };
        };
      };
    };
  };
}

export async function getUserLikes(
  params: GetUserLikesInput,
): Promise<GetUserLikesOutput> {
  // Likes are only exposed for the authenticated user; default to their own id
  // so callers can omit it (X throws GRAPHQL_VALIDATION_FAILED otherwise).
  const userId = params.userId ?? authUserId();
  const variables: Record<string, unknown> = {
    userId,
    count: params.count,
    includePromotedContent: false,
    withClientEventToken: false,
    withBirdwatchNotes: false,
    withVoice: true,
    withV2Timeline: true,
  };

  if (params.cursor) {
    variables.cursor = params.cursor;
  }

  const data = await xGraphQL<LikesTimelineResponse>('Likes', variables);

  const posts: Tweet[] = [];
  let nextCursor: string | undefined;

  const instructions =
    data.data?.user?.result?.timeline?.timeline?.instructions;
  if (!instructions) return { posts };

  for (const instruction of instructions) {
    if (
      instruction.type !== 'TimelineAddEntries' &&
      instruction.type !== 'TimelineReplaceEntry'
    ) {
      continue;
    }

    if (!instruction.entries) continue;

    for (const entry of instruction.entries) {
      const entryId = entry.entryId;

      if (entryId.startsWith('cursor-bottom-')) {
        nextCursor = entry.content?.value;
        continue;
      }

      if (!entryId.startsWith('tweet-')) continue;

      const tweetResult = entry.content?.itemContent?.tweet_results?.result;
      if (!tweetResult) continue;

      // Unwrap TweetWithVisibilityResults wrapper if present
      const rawResult =
        tweetResult.__typename === 'TweetWithVisibilityResults'
          ? (tweetResult.tweet as Record<string, unknown>)
          : tweetResult;

      const tweet = parseTweet(rawResult);
      if (tweet) posts.push(tweet);
    }
  }

  return { posts, nextCursor };
}

// ============================================================================
// List Notifications
// ============================================================================

interface NotificationEntry {
  id?: string;
  timestampMs?: string;
  icon?: { id?: string };
  message?: {
    text?: string;
    entities?: Array<{ fromIndex?: number; toIndex?: number }>;
  };
}

interface NotificationsTimelineResponse {
  data: {
    notification_timeline: {
      timeline: {
        instructions: Array<{
          type: string;
          entries?: Array<{
            entryId: string;
            content: {
              entryType?: string;
              value?: string;
              itemContent?: {
                notification?: NotificationEntry;
                notificationResults?: {
                  notification?: NotificationEntry;
                };
              };
            };
          }>;
        }>;
      };
    };
  };
}

function extractNotification(
  itemContent: NonNullable<
    NotificationsTimelineResponse['data']['notification_timeline']['timeline']['instructions'][number]['entries']
  >[number]['content']['itemContent'],
): NotificationEntry | undefined {
  return (
    itemContent?.notification ?? itemContent?.notificationResults?.notification
  );
}

export async function listNotifications(
  params: ListNotificationsInput,
): Promise<ListNotificationsOutput> {
  const variables: Record<string, unknown> = {
    count: params.count,
    includePromotedContent: false,
    timeline_type: params.timelineType ? params.timelineType : 'All',
  };

  if (params.cursor) {
    variables.cursor = params.cursor;
  }

  const data = await xGraphQL<NotificationsTimelineResponse>(
    'NotificationsTimeline',
    variables,
  );

  const notifications: Notification[] = [];
  let nextCursor: string | undefined;

  const instructions = data.data?.notification_timeline?.timeline?.instructions;
  if (!instructions) return { notifications };

  for (const instruction of instructions) {
    if (instruction.type !== 'TimelineAddEntries') continue;

    if (!instruction.entries) continue;

    for (const entry of instruction.entries) {
      const entryId = entry.entryId;

      if (entryId.startsWith('cursor-bottom')) {
        nextCursor = entry.content?.value;
        continue;
      }

      if (!entryId.startsWith('notification-')) continue;

      const notif = extractNotification(entry.content?.itemContent);
      if (!notif) continue;

      const id = notif.id;
      const timestampMs = notif.timestampMs;
      const iconType = notif.icon?.id;
      const message = notif.message?.text;

      if (!id || !timestampMs || !iconType || !message) continue;

      const timestamp = toIsoDate(timestampMs);

      const entities = notif.message?.entities
        ?.filter((e) => e.fromIndex !== undefined && e.toIndex !== undefined)
        .map((e) => ({
          fromIndex: e.fromIndex as number,
          toIndex: e.toIndex as number,
        }));

      notifications.push({
        id,
        timestamp,
        iconType,
        message,
        entities: entities?.length ? entities : undefined,
      });
    }
  }

  return { notifications, nextCursor };
}

// ============================================================================
// Update Profile
// ============================================================================

interface UpdateProfileResponse {
  id_str: string;
  name: string;
  screen_name: string;
  description: string;
  location: string;
  url?: string;
  entities?: {
    url?: {
      urls?: Array<{ expanded_url?: string }>;
    };
  };
}

export async function updateProfile(
  params: UpdateProfileInput,
): Promise<UpdateProfileOutput> {
  const body = new URLSearchParams();

  if (params.name !== undefined) body.set('name', params.name);
  if (params.description !== undefined)
    body.set('description', params.description);
  if (params.location !== undefined) body.set('location', params.location);
  if (params.url !== undefined) body.set('url', params.url);

  const data = await xRestPost<UpdateProfileResponse>(
    '/1.1/account/update_profile.json',
    body,
  );

  const expandedUrl = data.entities?.url?.urls?.[0]?.expanded_url;

  return {
    success: true,
    profile: {
      id: data.id_str,
      name: data.name,
      screenName: data.screen_name,
      description: data.description,
      location: data.location !== '' ? data.location : undefined,
      url: expandedUrl,
    },
  };
}

// ============================================================================
// Send DM
// ============================================================================

interface SendDMRawResponse {
  entries?: Array<{
    message?: {
      id?: string;
      conversation_id?: string;
      message_data?: {
        id?: string;
        text?: string;
        sender_id?: string;
        recipient_id?: string;
      };
    };
  }>;
  errors?: Array<{ code?: number; message?: string }>;
}

/**
 * Map X's app-level DM-send errors (returned in the 200 body, NOT the HTTP
 * status) to typed errors. `349` = the recipient does not accept DMs from this
 * account → PermissionDenied. Anything else surfaces with X's real message
 * instead of the opaque "no message ID" ContractDrift dump.
 */
function throwForDMErrors(
  errors: Array<{ code?: number; message?: string }> | undefined,
): void {
  if (!errors?.length) return;
  if (errors.some((e) => e.code === 349)) {
    throw new PermissionDenied(
      'Recipient does not accept Direct Messages from this account (X error 349). They must follow you, or enable "Allow message requests from everyone".',
    );
  }
  const e = errors[0];
  throw new UpstreamError(`sendDM failed: ${e.message ?? `X error ${e.code}`}`);
}

export async function sendDM(params: SendDMInput): Promise<SendDMOutput> {
  const data = await xRestPost<SendDMRawResponse>('/1.1/dm/new2.json', {
    conversation_id: params.conversationId,
    text: params.text,
    request_id: crypto.randomUUID(),
  });

  throwForDMErrors(data.errors);
  const msg = data.entries?.[0]?.message;
  if (!msg?.id) {
    throw new ContractDrift(
      `sendDM returned no message ID. Response: ${JSON.stringify(data)}`,
    );
  }

  return {
    eventId: msg.id,
    conversationId: msg.conversation_id ?? params.conversationId,
    text: msg.message_data?.text ?? params.text,
  };
}

// ============================================================================
// List DM Inbox
// ============================================================================

interface InboxEntry {
  message?: {
    id?: string;
    time?: string;
    conversation_id?: string;
    message_data?: {
      text?: string;
      sender_id?: string;
      time?: string;
    };
  };
}

interface InboxConversation {
  conversation_id?: string;
  type?: string;
  participants?: Array<{ user_id?: string }>;
}

interface InboxInitialStateResponse {
  inbox_initial_state?: {
    entries?: InboxEntry[];
    conversations?: Record<string, InboxConversation>;
    cursor?: string;
  };
}

export async function listDMInbox(
  _params: ListDMInboxInput,
): Promise<ListDMInboxOutput> {
  const params = new URLSearchParams({
    nsfw_filtering_enabled: 'false',
    filter_low_quality: 'true',
    include_quality: 'all',
    dm_secret_conversations_enabled: 'false',
    krs_registration_enabled: 'true',
    ext: 'mediaColor,altText,mediaStats,highlightedLabel,voiceInfo',
  });

  const data = await xRestGet<InboxInitialStateResponse>(
    '/1.1/dm/inbox_initial_state.json',
    params,
  );

  const state = data.inbox_initial_state;
  if (!state) {
    throw new ContractDrift(
      `listDMInbox returned no inbox state. Response: ${JSON.stringify(data)}`,
    );
  }

  // Build a map of the latest message per conversation from entries
  const lastMessageByConversation: Record<
    string,
    { text: string; sender: string; timestamp: string }
  > = {};

  for (const entry of state.entries ?? []) {
    const msg = entry.message;
    if (!msg?.conversation_id || !msg.message_data?.sender_id) continue;

    const convId = msg.conversation_id;
    const timestamp =
      msg.message_data.time !== undefined ? msg.message_data.time : msg.time;
    if (!timestamp) continue;

    const existing = lastMessageByConversation[convId];

    if (!existing || timestamp > existing.timestamp) {
      lastMessageByConversation[convId] = {
        text: msg.message_data.text !== undefined ? msg.message_data.text : '',
        sender: msg.message_data.sender_id,
        timestamp,
      };
    }
  }

  const conversations = Object.entries(state.conversations ?? {}).map(
    ([id, conv]) => ({
      id,
      // X returns 'ONE_TO_ONE' | 'GROUP_DM'; default 1:1 when absent. The cast
      // is sound — the output schema's z.enum re-validates and surfaces drift.
      type: (conv.type ?? 'ONE_TO_ONE') as 'ONE_TO_ONE' | 'GROUP_DM',
      lastMessage: lastMessageByConversation[id]
        ? {
            ...lastMessageByConversation[id],
            timestamp: toIsoDate(lastMessageByConversation[id].timestamp),
          }
        : undefined,
      participants: (conv.participants ?? [])
        .map((p) => p.user_id)
        .filter((uid): uid is string => uid !== undefined && uid !== ''),
    }),
  );

  return {
    conversations,
    nextCursor: state.cursor,
  };
}

// ============================================================================
// Get DM Conversation (messages in a conversation)
// ============================================================================

interface ConversationTimelineResponse {
  conversation_timeline?: {
    status?: string;
    min_entry_id?: string;
    max_entry_id?: string;
    entries?: Array<{
      message?: {
        id?: string;
        time?: string;
        conversation_id?: string;
        message_data?: {
          id?: string;
          text?: string;
          sender_id?: string;
          recipient_id?: string;
          time?: string;
        };
      };
    }>;
    users?: Record<
      string,
      {
        id_str?: string;
        name?: string;
        screen_name?: string;
        profile_image_url_https?: string;
      }
    >;
  };
}

export async function getDMConversation(
  params: GetDMConversationInput,
): Promise<GetDMConversationOutput> {
  const queryParams = new URLSearchParams({
    count: String(params.count ?? 50),
  });
  if (params.cursor) {
    queryParams.set('max_id', params.cursor);
  }

  const data = await xRestGet<ConversationTimelineResponse>(
    `/1.1/dm/conversation/${params.conversationId}.json`,
    queryParams,
  );

  const timeline = data.conversation_timeline;
  if (!timeline) {
    throw new ContractDrift(
      `getDMConversation returned no timeline. Response: ${JSON.stringify(data)}`,
    );
  }

  const messages = (timeline.entries ?? [])
    .filter((e) => e.message?.message_data?.text !== undefined)
    .map((e) => {
      const msg = e.message!;
      const md = msg.message_data!;
      return {
        id: msg.id ?? md.id ?? '',
        text: md.text ?? '',
        senderId: md.sender_id ?? '',
        recipientId: md.recipient_id ?? '',
        timestamp: toIsoDate(md.time ?? msg.time),
      };
    });

  const participants = Object.entries(timeline.users ?? {}).map(([id, u]) => ({
    id,
    name: u.name ?? '',
    screenName: u.screen_name ?? '',
    profileImageUrl: u.profile_image_url_https,
  }));

  return {
    messages,
    participants,
    nextCursor:
      timeline.status === 'AT_END' ? undefined : timeline.min_entry_id,
  };
}

// ============================================================================
// Delete DM Conversation
// ============================================================================

export async function deleteDMConversation(
  params: DeleteDMConversationInput,
): Promise<DeleteDMConversationOutput> {
  await xRestDelete(
    `/1.1/dm/conversation/${params.conversationId}/delete.json`,
  );
  return { success: true };
}

// ============================================================================
// React to DM
// ============================================================================

export async function reactToDM(
  params: ReactToDMInput,
): Promise<ReactToDMOutput> {
  const csrf = freshCsrf();
  const txId = await generateTransactionId('/1.1/dm/reaction/new.json', 'POST');

  const body = new URLSearchParams();
  body.append('conversation_id', params.conversationId);
  body.append('id', params.messageId);
  body.append('reaction_type', 'Emoji');
  body.append('reaction_key', params.reaction);

  const headers: Record<string, string> = {
    authorization: BEARER_TOKEN,
    'content-type': 'application/x-www-form-urlencoded',
    'x-csrf-token': csrf,
    'x-twitter-auth-type': 'OAuth2Session',
    'x-twitter-active-user': 'yes',
  };
  if (txId) headers['x-client-transaction-id'] = txId;

  const response = await fetch('https://api.x.com/1.1/dm/reaction/new.json', {
    method: 'POST',
    credentials: 'include',
    headers,
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => undefined);
    throwForStatus(response.status, text);
  }

  return { success: true };
}

// ============================================================================
// Remove Reaction
// ============================================================================

export async function removeReaction(
  params: RemoveReactionInput,
): Promise<RemoveReactionOutput> {
  const csrf = freshCsrf();
  const txId = await generateTransactionId(
    '/1.1/dm/reaction/delete.json',
    'POST',
  );

  const body = new URLSearchParams();
  body.append('conversation_id', params.conversationId);
  body.append('id', params.messageId);
  body.append('reaction_type', 'Emoji');
  body.append('reaction_key', params.reaction);

  const headers: Record<string, string> = {
    authorization: BEARER_TOKEN,
    'content-type': 'application/x-www-form-urlencoded',
    'x-csrf-token': csrf,
    'x-twitter-auth-type': 'OAuth2Session',
    'x-twitter-active-user': 'yes',
  };
  if (txId) headers['x-client-transaction-id'] = txId;

  const response = await fetch(
    'https://api.x.com/1.1/dm/reaction/delete.json',
    {
      method: 'POST',
      credentials: 'include',
      headers,
      body: body.toString(),
    },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => undefined);
    throwForStatus(response.status, text);
  }

  return { success: true };
}

// ============================================================================
// Send DM Image
// ============================================================================

interface MediaUploadInitResponse {
  media_id_string: string;
  expires_after_secs: number;
}


export async function sendDMImage(
  params: SendDMImageInput,
): Promise<SendDMImageOutput> {
  const csrf = freshCsrf();

  const binary = atob(params.imageBase64);
  const totalBytes = binary.length;

  const authHeaders: Record<string, string> = {
    authorization: BEARER_TOKEN,
    'x-csrf-token': csrf,
    'x-twitter-auth-type': 'OAuth2Session',
  };

  // Step 1: INIT
  const initBody = new URLSearchParams();
  initBody.append('command', 'INIT');
  initBody.append('total_bytes', totalBytes.toString());
  initBody.append('media_type', params.mimeType);
  initBody.append('media_category', 'dm_image');

  const initResp = await fetch('https://upload.x.com/1.1/media/upload.json', {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders,
    body: initBody,
  });

  if (!initResp.ok) {
    const text = await initResp.text().catch(() => undefined);
    throwForStatus(initResp.status, text);
  }

  const initData: MediaUploadInitResponse = await initResp.json();
  const mediaId = initData.media_id_string;

  // Step 2: APPEND
  const appendForm = new FormData();
  appendForm.append('command', 'APPEND');
  appendForm.append('media_id', mediaId);
  appendForm.append('segment_index', '0');
  appendForm.append('media_data', params.imageBase64);

  const appendResp = await fetch('https://upload.x.com/1.1/media/upload.json', {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders,
    body: appendForm,
  });

  if (!appendResp.ok) {
    const text = await appendResp.text().catch(() => undefined);
    throwForStatus(appendResp.status, text);
  }

  // Step 3: FINALIZE
  const finalizeBody = new URLSearchParams();
  finalizeBody.append('command', 'FINALIZE');
  finalizeBody.append('media_id', mediaId);

  const finalizeResp = await fetch(
    'https://upload.x.com/1.1/media/upload.json',
    {
      method: 'POST',
      credentials: 'include',
      headers: authHeaders,
      body: finalizeBody,
    },
  );

  if (!finalizeResp.ok) {
    const text = await finalizeResp.text().catch(() => undefined);
    throwForStatus(finalizeResp.status, text);
  }

  // Step 4: Send DM with media
  const dmData = await xRestPost<SendDMRawResponse>('/1.1/dm/new2.json', {
    conversation_id: params.conversationId,
    text: params.text ?? '',
    media_id: mediaId,
    request_id: crypto.randomUUID(),
  });

  throwForDMErrors(dmData.errors);
  const msg = dmData.entries?.[0]?.message;
  if (!msg?.id) {
    throw new ContractDrift(
      `sendDMImage: DM sent but no message ID returned. Response: ${JSON.stringify(dmData)}`,
    );
  }

  return {
    eventId: msg.id,
    conversationId: msg.conversation_id ?? params.conversationId,
    mediaId,
  };
}

// ============================================================================
// Delete DM (single message)
// ============================================================================

export async function deleteDM(params: DeleteDMInput): Promise<DeleteDMOutput> {
  const csrf = freshCsrf();
  const txId = await generateTransactionId('/1.1/dm/destroy.json', 'POST');

  const body = new URLSearchParams();
  body.append('id', params.messageId);
  body.append('request_id', crypto.randomUUID());

  const headers: Record<string, string> = {
    authorization: BEARER_TOKEN,
    'content-type': 'application/x-www-form-urlencoded',
    'x-csrf-token': csrf,
    'x-twitter-auth-type': 'OAuth2Session',
    'x-twitter-active-user': 'yes',
  };
  if (txId) headers['x-client-transaction-id'] = txId;

  const response = await fetch('https://api.x.com/1.1/dm/destroy.json', {
    method: 'POST',
    credentials: 'include',
    headers,
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => undefined);
    throwForStatus(response.status, text);
  }

  return { success: true };
}

// ============================================================================
// List Accounts (multi-account)
// ============================================================================

interface MultiAccountListResponse {
  users?: Array<{
    user_id?: string;
    name?: string;
    screen_name?: string;
    avatar_image_url?: string;
    is_suspended?: boolean;
    is_verified?: boolean;
    is_protected?: boolean;
    is_auth_valid?: boolean;
  }>;
}

export async function listAccounts(
  _params: ListAccountsInput,
): Promise<ListAccountsOutput> {
  const data = await xRestGet<MultiAccountListResponse>(
    '/1.1/account/multi/list.json',
    new URLSearchParams(),
  );

  const currentUserId = (() => {
    for (const cookie of document.cookie.split(';')) {
      const trimmed = cookie.trim();
      if (trimmed.startsWith('twid=')) {
        const decoded = decodeURIComponent(trimmed.substring(5));
        const match = decoded.match(/u=(\d+)/);
        if (match) return match[1];
      }
    }
    return '';
  })();

  const accounts = (data.users ?? []).map((u) => ({
    userId: u.user_id ?? '',
    name: u.name ?? '',
    screenName: u.screen_name ?? '',
    avatarUrl: u.avatar_image_url,
    isActive: u.user_id === currentUserId,
    isAuthValid: u.is_auth_valid ?? false,
  }));

  return { accounts };
}

// ============================================================================
// Switch Account
// ============================================================================

interface SwitchAccountResponse {
  status?: string;
}

export async function switchAccount(
  params: SwitchAccountInput,
): Promise<SwitchAccountOutput> {
  const body = new URLSearchParams({ user_id: params.userId });

  const data = await xDomainPost<SwitchAccountResponse>(
    '/i/api/1.1/account/multi/switch.json',
    body,
  );

  if (data.status !== 'ok') {
    throw new UpstreamError(`switchAccount failed. Response: ${JSON.stringify(data)}`);
  }

  // Read the new user ID from the updated cookie
  const newUserId = (() => {
    for (const cookie of document.cookie.split(';')) {
      const trimmed = cookie.trim();
      if (trimmed.startsWith('twid=')) {
        const decoded = decodeURIComponent(trimmed.substring(5));
        const match = decoded.match(/u=(\d+)/);
        if (match) return match[1];
      }
    }
    return params.userId;
  })();

  return {
    success: true,
    userId: newUserId,
  };
}

// ============================================================================
// Get Post (single tweet + reply thread) — TweetDetail
// ============================================================================

interface TweetDetailResponse {
  data?: {
    threaded_conversation_with_injections_v2?: {
      instructions?: Array<{
        type: string;
        entries?: Array<{
          entryId: string;
          content?: {
            value?: string;
            itemContent?: {
              tweet_results?: { result?: Record<string, unknown> };
            };
            items?: Array<{
              item?: {
                itemContent?: {
                  tweet_results?: { result?: Record<string, unknown> };
                };
              };
            }>;
          };
        }>;
      }>;
    };
  };
}

/** Unwrap TweetWithVisibilityResults, then parse, in one step. */
function unwrapAndParseTweet(
  result: Record<string, unknown> | undefined,
): Tweet | null {
  if (!result) return null;
  const unwrapped =
    result.__typename === 'TweetWithVisibilityResults'
      ? (result.tweet as Record<string, unknown> | undefined)
      : result;
  return unwrapped ? parseTweet(unwrapped) : null;
}

export async function getPost(params: GetPostInput): Promise<GetPostOutput> {
  const variables: Record<string, unknown> = {
    focalTweetId: params.tweetId,
    with_rux_injections: false,
    includePromotedContent: false,
    withCommunity: true,
    withQuickPromoteEligibilityTweetFields: true,
    withBirdwatchNotes: true,
    withVoice: true,
    withV2Timeline: true,
  };
  if (params.cursor) variables.cursor = params.cursor;

  const data = await xGraphQL<TweetDetailResponse>(
    'TweetDetail',
    variables,
    GRAPHQL_FEATURES,
    { withArticleRichContentState: false, withArticlePlainText: false },
  );

  const instructions =
    data.data?.threaded_conversation_with_injections_v2?.instructions || [];

  let post: Tweet | null = null;
  const replies: Tweet[] = [];
  let nextCursor: string | undefined;

  for (const instruction of instructions) {
    if (instruction.type !== 'TimelineAddEntries') continue;
    for (const entry of instruction.entries || []) {
      const entryId = entry.entryId || '';

      if (entryId.startsWith('cursor-bottom-')) {
        nextCursor = entry.content?.value;
        continue;
      }

      if (entryId.startsWith('tweet-')) {
        const tweet = unwrapAndParseTweet(
          entry.content?.itemContent?.tweet_results?.result,
        );
        if (!tweet) continue;
        if (tweet.id === params.tweetId) post = tweet;
        else replies.push(tweet);
        continue;
      }

      if (entryId.startsWith('conversationthread-')) {
        for (const item of entry.content?.items || []) {
          const tweet = unwrapAndParseTweet(
            item.item?.itemContent?.tweet_results?.result,
          );
          if (tweet && tweet.id !== params.tweetId) replies.push(tweet);
        }
      }
    }
  }

  if (!post) {
    throw new NotFound(
      `Post ${params.tweetId} not found or not accessible (deleted, private, or blocked).`,
    );
  }

  return { post, replies, nextCursor };
}

// ============================================================================
// Create Thread (composes createPost)
// ============================================================================

export async function createThread(
  params: CreateThreadInput,
): Promise<CreateThreadOutput> {
  if (params.texts.length < 2) {
    throw new Validation('A thread needs at least 2 posts');
  }

  const posts: Tweet[] = [];
  let replyToTweetId: string | undefined;

  // Each post replies to the previous one. createPost already applies write
  // jitter/rate pacing, so no extra spacing needed here.
  for (let i = 0; i < params.texts.length; i++) {
    const result = await createPost({
      text: params.texts[i],
      replyToTweetId,
      replyRestriction: i === 0 ? params.replyRestriction : undefined,
    });
    posts.push(result.post);
    replyToTweetId = result.post.id;
  }

  return { posts };
}

// ============================================================================
// Edit Post (Premium-only) — CreateTweet with edit_options
// ============================================================================

export async function editPost(params: EditPostInput): Promise<EditPostOutput> {
  const variables: Record<string, unknown> = {
    tweet_text: params.text,
    dark_request: false,
    media: { media_entities: [], possibly_sensitive: false },
    semantic_annotation_ids: [],
    edit_options: { previous_tweet_id: params.tweetId },
  };

  const data = await xGraphQLMutation<CreateTweetResponse>(
    'CreateTweet',
    variables,
    CREATE_TWEET_FEATURES,
  );

  if (data.errors?.length) {
    throw new UpstreamError(
      `editPost failed (note: editing requires X Premium and a post under ~60min old): ${data.errors[0].message}`,
    );
  }

  const tweetResult = data.data?.create_tweet?.tweet_results?.result;
  const tweet = tweetResult ? parseTweet(tweetResult) : null;
  if (!tweet) {
    throw new ContractDrift(
      `editPost returned no tweet data. Response: ${JSON.stringify(data.data)}`,
    );
  }

  return { post: tweet };
}

// ============================================================================
// Pin / Unpin Tweet — GraphQL PinTweet/UnpinTweet
// ============================================================================

// Verified live (June 2026): the web app pins via the GraphQL PinTweet/
// UnpinTweet mutations ({ tweet_id }, no features), NOT the legacy
// /1.1/account/pin_tweet.json REST endpoint.
interface PinTweetResponse {
  data?: Record<string, unknown>;
  errors?: Array<{ message: string; code?: number }>;
}

export async function pinTweet(params: PinTweetInput): Promise<PinTweetOutput> {
  const data = await xGraphQLMutation<PinTweetResponse>('PinTweet', {
    tweet_id: params.tweetId,
  });
  if (data.errors?.length) {
    throw new UpstreamError(`PinTweet failed: ${data.errors[0].message}`);
  }
  return { success: true };
}

export async function unpinTweet(
  params: UnpinTweetInput,
): Promise<UnpinTweetOutput> {
  const data = await xGraphQLMutation<PinTweetResponse>('UnpinTweet', {
    tweet_id: params.tweetId,
  });
  if (data.errors?.length) {
    throw new UpstreamError(`UnpinTweet failed: ${data.errors[0].message}`);
  }
  return { success: true };
}

// ============================================================================
// Social Graph — followers / following / search users / likers / reposters
// ============================================================================

type UserInstructions = Parameters<typeof parseUserTimelineInstructions>[0];

interface UsersTimelineResponse {
  data?: {
    user?: { result?: { timeline?: { timeline?: { instructions?: unknown } } } };
    search_by_raw_query?: {
      search_timeline?: { timeline?: { instructions?: unknown } };
    };
    favoriters_timeline?: { timeline?: { instructions?: unknown } };
    retweeters_timeline?: { timeline?: { instructions?: unknown } };
  };
}

export async function listFollowers(
  params: ListFollowersInput,
): Promise<ListFollowersOutput> {
  const data = await xGraphQL<UsersTimelineResponse>('Followers', {
    userId: params.userId ?? authUserId(),
    count: params.count ?? 20,
    includePromotedContent: false,
    ...(params.cursor ? { cursor: params.cursor } : {}),
  });
  const instructions = (data.data?.user?.result?.timeline?.timeline
    ?.instructions ?? []) as UserInstructions;
  return parseUserTimelineInstructions(instructions);
}

export async function listFollowing(
  params: ListFollowingInput,
): Promise<ListFollowingOutput> {
  const data = await xGraphQL<UsersTimelineResponse>('Following', {
    userId: params.userId ?? authUserId(),
    count: params.count ?? 20,
    includePromotedContent: false,
    ...(params.cursor ? { cursor: params.cursor } : {}),
  });
  const instructions = (data.data?.user?.result?.timeline?.timeline
    ?.instructions ?? []) as UserInstructions;
  return parseUserTimelineInstructions(instructions);
}

export async function searchUsers(
  params: SearchUsersInput,
): Promise<SearchUsersOutput> {
  const data = await xGraphQL<UsersTimelineResponse>('SearchTimeline', {
    rawQuery: params.query,
    count: params.count ?? 20,
    querySource: 'typed_query',
    product: 'People',
    ...(params.cursor ? { cursor: params.cursor } : {}),
  });
  const instructions = (data.data?.search_by_raw_query?.search_timeline?.timeline
    ?.instructions ?? []) as UserInstructions;
  return parseUserTimelineInstructions(instructions);
}

export async function getLikers(
  params: GetLikersInput,
): Promise<GetLikersOutput> {
  const data = await xGraphQL<UsersTimelineResponse>('Favoriters', {
    tweetId: params.tweetId,
    count: params.count ?? 20,
    includePromotedContent: false,
    ...(params.cursor ? { cursor: params.cursor } : {}),
  });
  const instructions = (data.data?.favoriters_timeline?.timeline
    ?.instructions ?? []) as UserInstructions;
  return parseUserTimelineInstructions(instructions);
}

export async function getReposters(
  params: GetRepostersInput,
): Promise<GetRepostersOutput> {
  const data = await xGraphQL<UsersTimelineResponse>('Retweeters', {
    tweetId: params.tweetId,
    count: params.count ?? 20,
    includePromotedContent: false,
    ...(params.cursor ? { cursor: params.cursor } : {}),
  });
  const instructions = (data.data?.retweeters_timeline?.timeline
    ?.instructions ?? []) as UserInstructions;
  return parseUserTimelineInstructions(instructions);
}

// ============================================================================
// Moderation — block / unblock / mute / unmute (REST v1.1)
// ============================================================================

export async function blockUser(
  params: BlockUserInput,
): Promise<BlockUserOutput> {
  const body = new URLSearchParams(FRIENDSHIP_PARAMS);
  body.set('user_id', params.userId);
  await xRestPost('/1.1/blocks/create.json', body);
  return { success: true };
}

export async function unblockUser(
  params: UnblockUserInput,
): Promise<UnblockUserOutput> {
  const body = new URLSearchParams(FRIENDSHIP_PARAMS);
  body.set('user_id', params.userId);
  await xRestPost('/1.1/blocks/destroy.json', body);
  return { success: true };
}

export async function muteUser(params: MuteUserInput): Promise<MuteUserOutput> {
  const body = new URLSearchParams({ user_id: params.userId });
  await xRestPost('/1.1/mutes/users/create.json', body);
  return { success: true };
}

export async function unmuteUser(
  params: UnmuteUserInput,
): Promise<UnmuteUserOutput> {
  const body = new URLSearchParams({ user_id: params.userId });
  await xRestPost('/1.1/mutes/users/destroy.json', body);
  return { success: true };
}

// ============================================================================
// Trends — GenericTimelineById on the static "trending" timeline
// ============================================================================

// The trends timeline id base64-encodes the literal "Timeline:…trending…"
// identifier and is stable across sessions; trends are personalized to the
// authed user's locale server-side (no WOEID). Verified live June 2026 against
// the Explore → Trending tab. If X ever rotates it, re-capture from that tab.
const TRENDS_TIMELINE_ID = 'VGltZWxpbmU6DAC2CwABAAAACHRyZW5kaW5nAAA=';

// GenericTimelineById's feature set, captured verbatim from the web app. X
// validates features strictly, so this is kept as its own exact object rather
// than reusing GRAPHQL_FEATURES (which carries a slightly different set).
const TRENDS_FEATURES: Record<string, boolean> = {
  rweb_video_screen_enabled: false,
  rweb_cashtags_enabled: true,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_profile_redirect_enabled: false,
  rweb_tipjar_consumption_enabled: false,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  premium_content_api_read_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: true,
  rweb_cashtags_composer_attachment_enabled: true,
  responsive_web_jetfuel_frame: true,
  responsive_web_grok_share_attachment_enabled: true,
  responsive_web_grok_annotations_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  rweb_conversational_replies_downvote_enabled: false,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  content_disclosure_indicator_enabled: true,
  content_disclosure_ai_generated_indicator_enabled: true,
  responsive_web_grok_show_grok_translated_post: true,
  responsive_web_grok_analysis_button_from_backend: true,
  post_ctas_fetch_enabled: true,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: false,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_grok_imagine_annotation_enabled: true,
  responsive_web_grok_community_note_auto_translation_is_enabled: true,
  responsive_web_enhance_cards_enabled: false,
};

interface TrendItemContent {
  __typename?: string;
  name?: string;
  domain_context?: string;
  rank?: string | number;
  trend_metadata?: { meta_description?: string };
  promoted_metadata?: unknown;
}

interface GenericTimelineResponse {
  data?: {
    timeline?: {
      timeline?: {
        instructions?: Array<{
          type: string;
          entries?: Array<{
            entryId: string;
            content?: { itemContent?: TrendItemContent };
          }>;
        }>;
      };
    };
  };
}

/**
 * Parse X's raw trend context line into a clean topic. X formats it as
 * "Trending in Technology", "Gaming · Trending", or "Politics · Trending";
 * returns the topic ("Technology"/"Gaming"/"Politics") plus the raw label.
 * Note: X only computes this for established accounts — brand-new accounts get
 * uncategorized trends (verified live across trending/for_you/sidebar), so this
 * is frequently absent regardless of the tool.
 */
function cleanTrendCategory(raw?: string): {
  category?: string;
  categoryLabel?: string;
} {
  if (!raw) return {};
  const inMatch = raw.match(/^Trending in (.+)$/);
  const dotMatch = raw.match(/^(.+?)\s*·\s*Trending$/);
  const category = (inMatch?.[1] ?? dotMatch?.[1] ?? raw).trim();
  return { category: category || undefined, categoryLabel: raw };
}

/** A trend name needs translation if it contains non-ASCII (non-Latin) chars. */
function needsTranslation(name: string): boolean {
  return /[^\x00-\x7F]/.test(name);
}

/**
 * Translate non-English trend names to English via the public Google Translate
 * gtx endpoint (no key needed). Names are batched into one newline-joined
 * request. Best-effort: any failure or a line-count mismatch returns an empty
 * map, so trends still return untranslated. Only pass names that need it.
 */
async function translateTrendNames(
  names: string[],
): Promise<Record<string, string>> {
  if (!names.length) return {};
  try {
    const q = encodeURIComponent(names.join('\n'));
    const resp = await fetch(
      `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=${q}`,
    );
    if (!resp.ok) return {};
    const data = (await resp.json()) as Array<Array<Array<string>>>;
    const lines = (data[0] ?? [])
      .map((s) => s[0])
      .join('')
      .split('\n');
    if (lines.length !== names.length) return {}; // misaligned — skip
    const map: Record<string, string> = {};
    names.forEach((name, i) => {
      const t = (lines[i] ?? '').trim();
      if (t && t !== name) map[name] = t;
    });
    return map;
  } catch {
    return {};
  }
}

/** Attach nameEnglish to any trend whose name is non-English (in place). */
async function attachTranslations(
  trends: Array<{ name: string; nameEnglish?: string }>,
): Promise<void> {
  const names = [
    ...new Set(trends.filter((t) => needsTranslation(t.name)).map((t) => t.name)),
  ];
  const map = await translateTrendNames(names);
  for (const t of trends) {
    const english = map[t.name];
    if (english) t.nameEnglish = english;
  }
}

export async function getTrends(
  params: GetTrendsInput,
): Promise<GetTrendsOutput> {
  const data = await xGraphQL<GenericTimelineResponse>(
    'GenericTimelineById',
    {
      timelineId: TRENDS_TIMELINE_ID,
      count: params.count ?? 20,
      withQuickPromoteEligibilityTweetFields: true,
    },
    TRENDS_FEATURES,
  );

  const instructions = data.data?.timeline?.timeline?.instructions ?? [];
  const trends: GetTrendsOutput['trends'] = [];

  for (const instruction of instructions) {
    if (instruction.type !== 'TimelineAddEntries') continue;
    for (const entry of instruction.entries ?? []) {
      const ic = entry.content?.itemContent;
      if (ic?.__typename !== 'TimelineTrend' || !ic.name) continue;

      const { category, categoryLabel } = cleanTrendCategory(ic.domain_context);
      const rankNum = ic.rank !== undefined ? Number(ic.rank) : NaN;

      trends.push({
        name: ic.name,
        rank: Number.isNaN(rankNum) ? undefined : rankNum,
        category,
        categoryLabel,
        postCountLabel: ic.trend_metadata?.meta_description || undefined,
        promoted: ic.promoted_metadata ? true : undefined,
        url: `https://x.com/search?q=${encodeURIComponent(ic.name)}`,
      });
    }
  }

  if (params.translate !== false) await attachTranslations(trends);

  return { trends };
}

// ============================================================================
// Location Trends — REST v1.1 (trends by country/city via WOEID)
// ============================================================================

// Personalized trends (getTrends, GenericTimelineById) only show the logged-in
// account's own locale. The /1.1/trends/* REST endpoints are the only way to get
// trends for an ARBITRARY place by WOEID, so they are kept for that purpose
// (not legacy here — distinct capability). Verified live June 2026.
interface AvailableLocation {
  name?: string;
  woeid?: number;
  country?: string;
  placeType?: { name?: string };
}

interface PlaceTrend {
  name?: string;
  url?: string;
  tweet_volume?: number | null;
  promoted_content?: unknown;
}

// available.json is a static-ish ~460-row list; cache it per session.
let availableLocationsCache: AvailableLocation[] | null = null;

async function fetchAvailableLocations(): Promise<AvailableLocation[]> {
  if (availableLocationsCache) return availableLocationsCache;
  const data = await xRestGet<AvailableLocation[]>(
    '/1.1/trends/available.json',
    new URLSearchParams(),
  );
  availableLocationsCache = Array.isArray(data) ? data : [];
  return availableLocationsCache;
}

export async function listTrendLocations(
  params: ListTrendLocationsInput,
): Promise<ListTrendLocationsOutput> {
  const all = await fetchAvailableLocations();
  const q = params.query?.trim().toLowerCase();
  const filtered = q
    ? all.filter(
        (l) =>
          (l.name ?? '').toLowerCase().includes(q) ||
          (l.country ?? '').toLowerCase().includes(q),
      )
    : all;

  return {
    locations: filtered.map((l) => ({
      name: l.name ?? '',
      woeid: l.woeid ?? 0,
      country: l.country || undefined,
      type: l.placeType?.name || undefined,
    })),
  };
}

export async function getTrendsByLocation(
  params: GetTrendsByLocationInput,
): Promise<GetTrendsByLocationOutput> {
  let woeid = params.woeid;
  let resolvedName: string | undefined;
  let resolvedCountry: string | undefined;

  // Resolve a location name → WOEID (exact name, then country, then contains).
  if (woeid === undefined && params.location) {
    const all = await fetchAvailableLocations();
    const q = params.location.trim().toLowerCase();
    const match =
      all.find((l) => (l.name ?? '').toLowerCase() === q) ??
      all.find((l) => (l.country ?? '').toLowerCase() === q) ??
      all.find((l) => (l.name ?? '').toLowerCase().includes(q));
    if (!match) {
      throw new NotFound(
        `No trend location matching "${params.location}". Use listTrendLocations to find a valid place and its WOEID.`,
      );
    }
    woeid = match.woeid;
    resolvedName = match.name;
    resolvedCountry = match.country;
  }

  if (woeid === undefined) woeid = 1; // Worldwide default

  const data = await xRestGet<
    Array<{ trends?: PlaceTrend[]; locations?: Array<{ name?: string; woeid?: number }> }>
  >('/1.1/trends/place.json', new URLSearchParams({ id: String(woeid) }));

  const block = Array.isArray(data) ? data[0] : undefined;
  const loc = block?.locations?.[0];

  const trends: GetTrendsByLocationOutput['trends'] = (block?.trends ?? [])
    .filter((t) => t.name)
    .map((t, i) => ({
      name: t.name as string,
      rank: i + 1,
      postCount:
        t.tweet_volume !== null && t.tweet_volume !== undefined
          ? t.tweet_volume
          : undefined,
      promoted: t.promoted_content ? true : undefined,
      url: `https://x.com/search?q=${encodeURIComponent(t.name as string)}`,
    }));

  if (params.translate !== false) await attachTranslations(trends);

  return {
    location: {
      name: resolvedName ?? loc?.name ?? 'Worldwide',
      woeid,
      country: resolvedCountry,
    },
    trends,
  };
}

// ============================================================================
// Lists
// ============================================================================

function parseList(raw: Record<string, unknown>): XList {
  const ownerResult = (
    raw.user_results as { result?: Record<string, unknown> } | undefined
  )?.result;
  const ownerCore = ownerResult?.core as
    | { name?: string; screen_name?: string }
    | undefined;
  // CreateList returns created_at in epoch SECONDS; the read ops return it in
  // MILLISECONDS. Normalize: < 1e12 means seconds.
  const createdRaw = Number(raw.created_at);
  const createdMs = createdRaw < 1e12 ? createdRaw * 1000 : createdRaw;

  const listId = (raw.id_str as string) || '';
  return {
    id: listId,
    url: `https://x.com/i/lists/${listId}`,
    name: (raw.name as string) || '',
    description: (raw.description as string) || '',
    mode: raw.mode === 'Private' ? 'Private' : 'Public',
    memberCount: (raw.member_count as number) || 0,
    subscriberCount: (raw.subscriber_count as number) || 0,
    createdAt: Number.isNaN(createdMs) ? '' : new Date(createdMs).toISOString(),
    following: (raw.following as boolean) || false,
    isMember: raw.is_member as boolean | undefined,
    owner: ownerResult
      ? {
          id: (ownerResult.rest_id as string) || '',
          name: ownerCore?.name || '',
          screenName: ownerCore?.screen_name || '',
        }
      : undefined,
  };
}

interface ListResponse {
  data?: { list?: Record<string, unknown> };
  errors?: Array<{ message: string; code?: number; path?: string[] }>;
}

/**
 * X returns a NON-FATAL partial GraphQL error when it can't serialize the
 * auto-assigned default banner of a list it just created/returned — the error
 * is scoped to `path: [..., "default_banner_media_results", "result"]` while the
 * mutation itself succeeds (HTTP 200, list/operation data present). Treating it
 * as fatal makes every list write throw even though the operation went through —
 * and worse, retries then spawn duplicate lists. Drop that cosmetic error and
 * surface only genuinely fatal ones.
 */
function fatalListErrors(
  errors?: Array<{ message: string; code?: number; path?: string[] }>,
): Array<{ message: string; code?: number; path?: string[] }> {
  return (errors ?? []).filter(
    (e) => !e.path?.includes('default_banner_media_results'),
  );
}

export async function getList(params: GetListInput): Promise<GetListOutput> {
  const data = await xGraphQL<ListResponse>('ListByRestId', {
    listId: params.listId,
  });
  const raw = data.data?.list;
  if (!raw) {
    throw new NotFound(
      `List ${params.listId} not found or not accessible. Response: ${JSON.stringify(data.data)}`,
    );
  }
  return { list: parseList(raw) };
}

interface ListOwnershipsResponse {
  data?: {
    user?: {
      result?: {
        timeline?: {
          timeline?: {
            instructions?: Array<{
              type: string;
              entries?: Array<{
                entryId: string;
                content?: {
                  value?: string;
                  itemContent?: { list?: Record<string, unknown> } & Record<
                    string,
                    unknown
                  >;
                };
              }>;
            }>;
          };
        };
      };
    };
  };
}

export async function listUserLists(
  params: ListUserListsInput,
): Promise<ListUserListsOutput> {
  const data = await xGraphQL<ListOwnershipsResponse>('ListOwnerships', {
    userId: params.userId ?? authUserId(),
    count: params.count ?? 20,
    isListMemberTargetUserId: false,
    ...(params.cursor ? { cursor: params.cursor } : {}),
  });

  const instructions =
    data.data?.user?.result?.timeline?.timeline?.instructions ?? [];
  const lists: XList[] = [];
  let nextCursor: string | undefined;

  for (const instruction of instructions) {
    for (const entry of instruction.entries ?? []) {
      const entryId = entry.entryId || '';
      if (entryId.startsWith('cursor-bottom-')) {
        nextCursor = entry.content?.value;
        continue;
      }
      if (!entryId.startsWith('list-')) continue;
      const ic = entry.content?.itemContent;
      const raw =
        (ic?.list as Record<string, unknown> | undefined) ??
        (ic as Record<string, unknown> | undefined);
      if (raw && raw.id_str) lists.push(parseList(raw));
    }
  }

  return { lists, nextCursor };
}

interface ListMembersResponse {
  data?: {
    list?: {
      members_timeline?: {
        timeline?: {
          instructions?: unknown;
        };
      };
    };
  };
}

export async function getListMembers(
  params: GetListMembersInput,
): Promise<GetListMembersOutput> {
  const data = await xGraphQL<ListMembersResponse>('ListMembers', {
    listId: params.listId,
    count: params.count ?? 20,
    ...(params.cursor ? { cursor: params.cursor } : {}),
  });
  const instructions = (data.data?.list?.members_timeline?.timeline
    ?.instructions ?? []) as Parameters<
    typeof parseUserTimelineInstructions
  >[0];
  return parseUserTimelineInstructions(instructions);
}

interface ListTweetsResponse {
  data?: {
    list?: {
      tweets_timeline?: {
        timeline?: {
          instructions?: unknown;
        };
      };
    };
  };
}

export async function getListTimeline(
  params: GetListTimelineInput,
): Promise<GetListTimelineOutput> {
  const data = await xGraphQL<ListTweetsResponse>('ListLatestTweetsTimeline', {
    listId: params.listId,
    count: params.count ?? 20,
    ...(params.cursor ? { cursor: params.cursor } : {}),
  });
  const instructions = (data.data?.list?.tweets_timeline?.timeline
    ?.instructions ?? []) as Parameters<typeof parseTimelineInstructions>[0];
  return parseTimelineInstructions(instructions);
}

export async function createList(
  params: CreateListInput,
): Promise<CreateListOutput> {
  const data = await xGraphQLMutation<ListResponse>('CreateList', {
    isPrivate: params.isPrivate ?? false,
    name: params.name,
    description: params.description ?? '',
  });
  const createErrors = fatalListErrors(data.errors);
  if (createErrors.length) {
    throw new UpstreamError(`CreateList failed: ${createErrors[0].message}`);
  }
  const raw = data.data?.list;
  if (!raw) {
    throw new ContractDrift(
      `CreateList returned no list. Response: ${JSON.stringify(data.data)}`,
    );
  }
  return { list: parseList(raw) };
}

export async function deleteList(
  params: DeleteListInput,
): Promise<DeleteListOutput> {
  const data = await xGraphQLMutation<ListResponse>('DeleteList', {
    listId: params.listId,
  });
  const deleteErrors = fatalListErrors(data.errors);
  if (deleteErrors.length) {
    throw new UpstreamError(`DeleteList failed: ${deleteErrors[0].message}`);
  }
  return { success: true };
}

export async function addListMember(
  params: AddListMemberInput,
): Promise<AddListMemberOutput> {
  const data = await xGraphQLMutation<ListResponse>('ListAddMember', {
    listId: params.listId,
    userId: params.userId,
  });
  const addErrors = fatalListErrors(data.errors);
  if (addErrors.length) {
    throw new UpstreamError(`ListAddMember failed: ${addErrors[0].message}`);
  }
  return { success: true };
}

export async function removeListMember(
  params: RemoveListMemberInput,
): Promise<RemoveListMemberOutput> {
  const data = await xGraphQLMutation<ListResponse>('ListRemoveMember', {
    listId: params.listId,
    userId: params.userId,
  });
  const removeErrors = fatalListErrors(data.errors);
  if (removeErrors.length) {
    throw new UpstreamError(`ListRemoveMember failed: ${removeErrors[0].message}`);
  }
  return { success: true };
}

export async function followList(
  params: FollowListInput,
): Promise<FollowListOutput> {
  const data = await xGraphQLMutation<ListResponse>('ListSubscribe', {
    listId: params.listId,
  });
  const subErrors = fatalListErrors(data.errors);
  if (subErrors.length) {
    throw new UpstreamError(`ListSubscribe failed: ${subErrors[0].message}`);
  }
  return { success: true };
}

export async function unfollowList(
  params: UnfollowListInput,
): Promise<UnfollowListOutput> {
  const data = await xGraphQLMutation<ListResponse>('ListUnsubscribe', {
    listId: params.listId,
  });
  const unsubErrors = fatalListErrors(data.errors);
  if (unsubErrors.length) {
    throw new UpstreamError(`ListUnsubscribe failed: ${unsubErrors[0].message}`);
  }
  return { success: true };
}

// ============================================================================
// Articles (long-form essays) — TweetResultByRestId + article field toggles
// ============================================================================

// X Articles are read via TweetResultByRestId with withArticleRichContentState
// on; these features (incl. the article v2 flags) are required to get the body.
// Captured live June 2026.
const ARTICLE_FEATURES: Record<string, boolean> = {
  rweb_video_screen_enabled: false,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_profile_redirect_enabled: false,
  rweb_tipjar_consumption_enabled: false,
  verified_phone_label_enabled: false,
  premium_content_api_read_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: true,
  responsive_web_jetfuel_frame: true,
  responsive_web_grok_share_attachment_enabled: true,
  responsive_web_grok_annotations_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  responsive_web_twitter_article_data_v2_enabled: true,
  responsive_web_twitter_article_v2_apis_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  responsive_web_grok_show_grok_translated_post: true,
  responsive_web_grok_analysis_button_from_backend: true,
  post_ctas_fetch_enabled: true,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: false,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_grok_imagine_annotation_enabled: true,
  responsive_web_grok_community_note_auto_translation_is_enabled: false,
  responsive_web_enhance_cards_enabled: false,
};

interface DraftContentState {
  blocks?: Array<{
    type?: string;
    text?: string;
    entityRanges?: Array<{ key?: number }>;
  }>;
  entityMap?:
    | Array<{ key?: string | number; value?: DraftEntity }>
    | Record<string, DraftEntity>;
}
interface DraftEntity {
  type?: string;
  data?: Record<string, unknown>;
}

/**
 * Flatten an X Article's Draft.js content_state into readable Markdown-ish text.
 * Text blocks keep their structure (headers/lists/quotes); atomic blocks resolve
 * their entity (embedded post -> link, image -> url) via the entityMap, which X
 * returns either as an array of {key,value} or as an object map.
 */
function articleBodyToText(cs: DraftContentState | undefined): string {
  if (!cs || !Array.isArray(cs.blocks)) return '';

  const entities: Record<string, DraftEntity> = {};
  if (Array.isArray(cs.entityMap)) {
    for (const e of cs.entityMap) {
      if (e.key !== undefined && e.value) entities[String(e.key)] = e.value;
    }
  } else if (cs.entityMap && typeof cs.entityMap === 'object') {
    for (const k of Object.keys(cs.entityMap)) entities[k] = cs.entityMap[k];
  }

  const out: string[] = [];
  for (const block of cs.blocks) {
    const type = block.type ?? 'unstyled';

    if (type === 'atomic') {
      const key = block.entityRanges?.[0]?.key;
      const ent = key !== undefined ? entities[String(key)] : undefined;
      const et = (ent?.type ?? '').toUpperCase();
      const data = ent?.data ?? {};
      if (et === 'TWEET' && data.tweetId) {
        out.push(`[embedded post: https://x.com/i/status/${String(data.tweetId)}]`);
      } else if (et === 'MEDIA' || et === 'IMAGE') {
        const url =
          (data.url as string) ||
          (data.mediaUrl as string) ||
          (data.media_url_https as string) ||
          '';
        out.push(url ? `[image: ${url}]` : '[image]');
      }
      continue;
    }

    const text = decodeEntities((block.text ?? '').trim());
    if (!text) continue;
    switch (type) {
      case 'header-one':
        out.push(`# ${text}`);
        break;
      case 'header-two':
        out.push(`## ${text}`);
        break;
      case 'header-three':
        out.push(`### ${text}`);
        break;
      case 'unordered-list-item':
        out.push(`- ${text}`);
        break;
      case 'ordered-list-item':
        out.push(`1. ${text}`);
        break;
      case 'blockquote':
        out.push(`> ${text}`);
        break;
      case 'code-block':
        out.push(`\`\`\`\n${text}\n\`\`\``);
        break;
      default:
        out.push(text);
    }
  }

  return out.join('\n\n').trim();
}

interface ArticleTweetResponse {
  data?: {
    tweetResult?: {
      result?: {
        core?: { user_results?: { result?: Record<string, unknown> } };
        article?: {
          article_results?: {
            result?: {
              rest_id?: string;
              title?: string;
              preview_text?: string;
              content_state?: DraftContentState;
              cover_media?: { media_info?: { original_img_url?: string } };
            };
          };
        };
      };
    };
  };
}

// An X Article has TWO ids: the "seed tweet" id (works with TweetResultByRestId)
// and the article-entity id (the number in the /i/article/<id> URL). They differ.
// ArticleRedirectScreenQuery maps entity-id -> seed-tweet-id, but it's a lazy op
// that isn't discoverable from a cold page (module not loaded; operationName is a
// variable so it's not a literal in bundles). Seed its hash as a last-resort
// fallback — dynamic discovery is still tried first. May drift; the primary
// seed-tweet-id path does NOT depend on it.
const ARTICLE_REDIRECT_FALLBACK_HASH = 'zrSRXJmE1vj37AUmkh2oGg';

interface ArticleRedirectResponse {
  data?: {
    article_result_by_rest_id?: {
      result?: { metadata?: { tweet_results?: { rest_id?: string } } };
    };
  };
}

/** Fetch + parse an article given its SEED TWEET id. Returns null if that id
 *  carries no article. */
async function fetchArticleByTweetId(
  tweetId: string,
): Promise<GetArticleOutput['article'] | null> {
  const data = await xGraphQL<ArticleTweetResponse>(
    'TweetResultByRestId',
    {
      tweetId,
      withCommunity: false,
      includePromotedContent: false,
      withVoice: false,
    },
    ARTICLE_FEATURES,
    { withArticleRichContentState: true, withArticlePlainText: false },
  );
  const result = data.data?.tweetResult?.result;
  const art = result?.article?.article_results?.result;
  if (!art) return null;

  const authorResult = result?.core?.user_results?.result;
  const authorCore = authorResult?.core as
    | { name?: string; screen_name?: string }
    | undefined;
  const entityId = art.rest_id || tweetId;

  return {
    id: entityId,
    title: decodeEntities(art.title || ''),
    previewText: decodeEntities(art.preview_text || ''),
    body: articleBodyToText(art.content_state),
    coverImageUrl: art.cover_media?.media_info?.original_img_url,
    author: {
      id: (authorResult?.rest_id as string) || '',
      name: authorCore?.name || '',
      screenName: authorCore?.screen_name || '',
    },
    createdAt: snowflakeToIso(tweetId) ?? new Date(0).toISOString(),
    url: `https://x.com/i/article/${entityId}`,
  };
}

/** Map an article-entity id (the /i/article/<id> URL id) to its seed tweet id. */
async function resolveArticleSeedTweetId(
  articleEntityId: string,
): Promise<string | null> {
  const read = async () => {
    const data = await xGraphQL<ArticleRedirectResponse>(
      'ArticleRedirectScreenQuery',
      { articleEntityId },
      {}, // this op takes no feature flags
    );
    return (
      data.data?.article_result_by_rest_id?.result?.metadata?.tweet_results
        ?.rest_id ?? null
    );
  };
  try {
    return await read();
  } catch {
    // Discovery failed (lazy op) — seed the known hash and retry once.
    queryHashCache.ArticleRedirectScreenQuery = ARTICLE_REDIRECT_FALLBACK_HASH;
    try {
      return await read();
    } catch {
      return null;
    }
  }
}

export async function getArticle(
  params: GetArticleInput,
): Promise<GetArticleOutput> {
  // First assume the id is the article POST (seed tweet) id — the reliable path
  // and what timelines/getUserPosts return as the post id.
  let article = await fetchArticleByTweetId(params.articleId);

  // Otherwise treat it as the /i/article/<id> entity id and resolve to the seed.
  if (!article) {
    const seed = await resolveArticleSeedTweetId(params.articleId);
    if (seed && seed !== params.articleId) {
      article = await fetchArticleByTweetId(seed);
    }
  }

  if (!article) {
    throw new NotFound(
      `Could not read article "${params.articleId}". Pass the article POST's id ` +
        `(the tweet id — e.g. the Tweet.id of a post whose .article field is set, ` +
        `from getUserPosts/getPost). The number in an /i/article/<id> URL also works.`,
    );
  }
  return { article };
}

// ============================================================================
// User Articles (discover a user's long-form essays) — UserArticlesTweets
// ============================================================================

interface UserArticlesResponse {
  data?: {
    user?: {
      result?: {
        timeline?: {
          timeline?: {
            instructions?: Array<{
              type: string;
              entries?: Array<{
                entryId: string;
                content?: {
                  value?: string;
                  itemContent?: {
                    tweet_results?: { result?: Record<string, unknown> };
                  };
                };
              }>;
            }>;
          };
        };
      };
    };
  };
}

export async function getUserArticles(
  params: GetUserArticlesInput,
): Promise<GetUserArticlesOutput> {
  let userId = params.userId;
  if (!userId && params.screenName) {
    const prof = await xGraphQL<UserByScreenNameResponse>(
      'UserByScreenName',
      { screen_name: params.screenName, withGrokTranslatedBio: false },
      PROFILE_FEATURES,
    );
    userId = prof.data?.user?.result?.rest_id as string | undefined;
    if (!userId) {
      throw new NotFound(`User @${params.screenName} not found.`);
    }
  }
  if (!userId) userId = authUserId();

  const data = await xGraphQL<UserArticlesResponse>(
    'UserArticlesTweets',
    {
      userId,
      count: params.count ?? 20,
      includePromotedContent: false,
      withVoice: true,
      ...(params.cursor ? { cursor: params.cursor } : {}),
    },
    GRAPHQL_FEATURES,
    { withArticlePlainText: false },
  );

  const instructions =
    data.data?.user?.result?.timeline?.timeline?.instructions ?? [];
  const articles: GetUserArticlesOutput['articles'] = [];
  let nextCursor: string | undefined;

  for (const instruction of instructions) {
    if (instruction.type !== 'TimelineAddEntries') continue;
    for (const entry of instruction.entries ?? []) {
      const entryId = entry.entryId || '';
      if (entryId.startsWith('cursor-bottom-')) {
        nextCursor = entry.content?.value;
        continue;
      }
      if (!entryId.startsWith('tweet-')) continue;

      let tr = entry.content?.itemContent?.tweet_results?.result;
      if (tr?.__typename === 'TweetWithVisibilityResults') {
        tr = tr.tweet as Record<string, unknown> | undefined;
      }
      const art = (
        tr?.article as
          | {
              article_results?: {
                result?: {
                  rest_id?: string;
                  title?: string;
                  preview_text?: string;
                  cover_media?: { media_info?: { original_img_url?: string } };
                };
              };
            }
          | undefined
      )?.article_results?.result;
      if (!art) continue;

      const seedId = (tr?.rest_id as string) || '';
      articles.push({
        id: seedId,
        title: decodeEntities(art.title || ''),
        previewText: decodeEntities(art.preview_text || ''),
        coverImageUrl: art.cover_media?.media_info?.original_img_url,
        createdAt: snowflakeToIso(seedId) ?? new Date(0).toISOString(),
        url: `https://x.com/i/article/${art.rest_id || seedId}`,
      });
    }
  }

  return { articles, nextCursor };
}
