/**
 * TikTok Studio Library
 *
 * Browser-executable TikTok Studio operations via internal APIs.
 * Requires user to be logged into TikTok Studio at tiktok.com/tiktokstudio.
 *
 * IMPORTANT: TikTok's modified window.fetch adds anti-bot tokens (msToken,
 * X-Bogus, X-Gnarly) automatically. All fetch() calls go through their
 * interceptor; no manual signature computation needed.
 */

import { Unauthenticated, UpstreamError, ContractDrift, Validation, throwForStatus } from '@vallum/_runtime';

// Types from schemas - single source of truth
export type {
  GetContextOutput,
  Post,
  ListPostsInput,
  ListPostsOutput,
  InsightDataPoint,
  GetAccountAnalyticsInput,
  GetAccountAnalyticsOutput,
  GetPostAnalyticsInput,
  GetPostAnalyticsOutput,
  GetAudienceInsightsInput,
  GetAudienceInsightsOutput,
  GetFollowerGrowthInput,
  GetFollowerGrowthOutput,
  GetTopPostsInput,
  GetTopPostsOutput,
  Comment,
  CommentAuthor,
  ListCommentsInput,
  ListCommentsOutput,
  GetCommentCountInput,
  GetCommentCountOutput,
  ReplyToCommentInput,
  ReplyToCommentOutput,
  DeleteCommentInput,
  DeleteCommentOutput,
  GetTrendingPostsInput,
  GetTrendingPostsOutput,
  GetTrendingSoundsInput,
  GetTrendingSoundsOutput,
  GetTrendingHashtagsInput,
  GetTrendingHashtagsOutput,
  GetProfileInput,
  GetProfileOutput,
  UpdateProfileInput,
  UpdateProfileOutput,
  GetEarningsInput,
  GetEarningsOutput,
  GetMonetizationStatusInput,
  GetMonetizationStatusOutput,
  MonetizationProgram,
  DetailedPost,
  GetPostInput,
  GetPostOutput,
  Draft,
  ListDraftsInput,
  ListDraftsOutput,
  DeletePostInput,
  DeletePostOutput,
  UpdatePostInput,
  UpdatePostOutput,
} from './schemas';

import type {
  GetContextOutput,
  ListPostsOutput,
  GetAccountAnalyticsOutput,
  GetPostAnalyticsOutput,
  GetAudienceInsightsOutput,
  GetFollowerGrowthOutput,
  GetTopPostsOutput,
  ListCommentsOutput,
  GetCommentCountOutput,
  ReplyToCommentOutput,
  DeleteCommentOutput,
  GetTrendingPostsOutput,
  GetTrendingSoundsOutput,
  GetTrendingHashtagsOutput,
  GetProfileInput,
  GetProfileOutput,
  UpdateProfileInput,
  UpdateProfileOutput,
  GetEarningsInput,
  GetEarningsOutput,
  GetMonetizationStatusInput,
  GetMonetizationStatusOutput,
  GetPostInput,
  GetPostOutput,
  ListDraftsInput,
  ListDraftsOutput,
  DeletePostInput,
  DeletePostOutput,
  UpdatePostInput,
  UpdatePostOutput,
} from './schemas';

// ============================================================================
// Helpers
// ============================================================================

interface CommonParams {
  deviceId: string;
  region: string;
  language: string;
}

function buildApiUrl(
  path: string,
  common: CommonParams,
  extra?: Record<string, string>,
): string {
  const params = new URLSearchParams({
    locale: common.language,
    aid: '1988',
    priority_region: common.region,
    region: common.region,
    app_name: 'tiktok_creator_center',
    app_language: common.language,
    device_platform: 'web_pc',
    channel: 'tiktok_web',
    device_id: common.deviceId,
    ...extra,
  });
  return `${path}?${params.toString()}`;
}

async function apiPost<T>(
  url: string,
  body: unknown,
  csrfToken?: string,
): Promise<T> {
  const resp = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: {
      accept: 'application/json, text/plain, */*',
      'content-type': 'application/json',
      'agw-js-conv': 'str',
      ...(csrfToken ? { 'tt-csrf-token': csrfToken } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }

  const data = await resp.json();
  if (data.status_code !== undefined && data.status_code !== 0) {
    throw new UpstreamError(
      `TikTok API error: status_code=${data.status_code}, msg="${data.status_msg}". URL: ${url}`,
    );
  }
  return data as T;
}

async function apiGet<T>(url: string): Promise<T> {
  const resp = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    headers: {
      accept: 'application/json, text/plain, */*',
    },
  });

  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }

  const data = await resp.json();
  if (data.status_code !== 0 && data.status_code !== undefined) {
    throw new UpstreamError(
      `TikTok API error: status_code=${data.status_code}, msg="${data.status_msg}". URL: ${url}`,
    );
  }
  return data as T;
}

async function apiPostForm<T>(
  url: string,
  params: Record<string, string>,
): Promise<T> {
  const body = new URLSearchParams(params).toString();
  const resp = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: {
      accept: 'application/json, text/plain, */*',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }

  const data = await resp.json();
  if (data.status_code !== undefined && data.status_code !== 0) {
    throw new UpstreamError(
      `TikTok API error: status_code=${data.status_code}, msg="${data.status_msg}". URL: ${url}`,
    );
  }
  return data as T;
}

// Browser context params required by the Inspiration trending endpoints.
function getBrowserContextParams(): Record<string, string> {
  const nav = window.navigator;
  const ua = nav.userAgent;

  let browserName = 'chrome';
  let browserVersion = '120';
  const chromeMatch = ua.match(/Chrome\/(\d+)/);
  const safariMatch = ua.match(/Version\/(\d+).*Safari/);
  const firefoxMatch = ua.match(/Firefox\/(\d+)/);
  if (chromeMatch) {
    browserName = 'chrome';
    browserVersion = chromeMatch[1];
  } else if (safariMatch) {
    browserName = 'safari';
    browserVersion = safariMatch[1];
  } else if (firefoxMatch) {
    browserName = 'firefox';
    browserVersion = firefoxMatch[1];
  }

  let os = 'mac';
  if (/Windows/.test(ua)) os = 'windows';
  else if (/Linux/.test(ua)) os = 'linux';

  return {
    tz_name: Intl.DateTimeFormat().resolvedOptions().timeZone,
    os,
    screen_width: String(screen.width),
    screen_height: String(screen.height),
    browser_language: nav.language,
    browser_platform: nav.platform,
    browser_name: browserName,
    browser_version: browserVersion,
  };
}

function parseHistoryArray(
  arr:
    | Array<{ status: number; value?: number; date_key?: string }>
    | null
    | undefined,
): Array<{ value: number; date?: string }> {
  if (!arr) return [];
  return arr
    .filter((item) => item.status === 0)
    .map((item) => ({
      value: item.value ?? 0,
      ...(item.date_key ? { date: item.date_key } : {}),
    }));
}

function strOrEmpty(val: string | undefined): string {
  return val !== undefined ? val : '';
}

function numOrZero(val: number | undefined): number {
  return val !== undefined ? val : 0;
}

// ============================================================================
// Context
// ============================================================================

interface TikTokUser {
  uid: string;
  secUid: string;
  uniqueId: string;
  nickName: string;
  avatarUri: string[] | string;
  isPrivateAccount: boolean;
  analyticsOn: boolean;
  proAccountInfo?: { analyticsOn: boolean };
}

interface TikTokAppContext {
  csrfToken: string;
  wid: string;
  region: string;
  language: string;
  user: TikTokUser;
}

interface TikTokCreatorContext {
  commonAppContext: TikTokAppContext;
}

export async function getContext(): Promise<GetContextOutput> {
  const win = window as unknown as {
    __Creator_Center_Context__?: TikTokCreatorContext;
  };
  const ctx = win.__Creator_Center_Context__;
  if (!ctx) {
    throw new Unauthenticated(
      'TikTok Studio context not found. Make sure you are on a tiktokstudio page and the SPA has fully loaded. URL: ' +
        window.location.href,
    );
  }

  const appCtx = ctx.commonAppContext;
  if (!appCtx) {
    throw new Unauthenticated(
      'commonAppContext not found in Creator Center Context. URL: ' +
        window.location.href,
    );
  }

  const user = appCtx.user;
  if (!user) {
    throw new Unauthenticated(
      'User not found in commonAppContext. Are you logged in? URL: ' +
        window.location.href,
    );
  }

  const csrfToken = appCtx.csrfToken;
  if (!csrfToken) {
    throw new Unauthenticated(
      'CSRF token not found. The page may not have loaded fully. URL: ' +
        window.location.href,
    );
  }

  return {
    csrfToken,
    uid: user.uid,
    secUid: user.secUid,
    uniqueId: user.uniqueId,
    nickName: user.nickName || user.uniqueId,
    deviceId: appCtx.wid,
    region: appCtx.region,
    language: appCtx.language,
    avatarUrl: Array.isArray(user.avatarUri)
      ? user.avatarUri[0]
      : String(user.avatarUri),
    isPrivateAccount: Boolean(user.isPrivateAccount),
    analyticsOn: Boolean(user.analyticsOn || user.proAccountInfo?.analyticsOn),
  };
}

// ============================================================================
// Content / Posts
// ============================================================================

interface ItemListResponse {
  status_code: number;
  status_msg: string;
  cursor: number;
  has_more: boolean;
  item_list?: Array<{
    item_id: string;
    desc: string;
    create_time: number;
    post_time: number;
    duration: number;
    statistics?: {
      play_count?: number;
      digg_count?: number;
      comment_count?: number;
      share_count?: number;
      collect_count?: number;
    };
    cover_url?: string;
    video_url?: string;
    status?: number;
    is_scheduled?: boolean;
    scheduled_publish_time?: number;
  }>;
}

/**
 * List all published and scheduled TikTok posts with engagement stats.
 */
export async function listPosts(params: {
  csrfToken: string;
  deviceId: string;
  region: string;
  language: string;
  recentOnly?: boolean;
  maxPages?: number;
}): Promise<ListPostsOutput> {
  const common: CommonParams = {
    deviceId: params.deviceId,
    region: params.region,
    language: params.language,
  };

  const maxPages = params.maxPages ?? 5;
  const allPosts: ListPostsOutput['posts'] = [];
  let cursor = 0;
  let hasMore = true;

  for (let page = 0; page < maxPages && hasMore; page++) {
    const url = buildApiUrl('/tiktok/creator/manage/item_list/v1/', common);
    const data = await apiPost<ItemListResponse>(url, {
      cursor,
      size: 50,
      query: {
        sort_orders: [{ field_name: 'post_time', order: 2 }],
        conditions: [],
        is_recent_posts: params.recentOnly ?? false,
      },
    });

    if (data.item_list) {
      for (const item of data.item_list) {
        allPosts.push({
          itemId: item.item_id,
          desc: item.desc || '',
          createTime: item.create_time || 0,
          postTime: item.post_time || 0,
          duration: item.duration || 0,
          stats: {
            playCount: item.statistics?.play_count ?? 0,
            diggCount: item.statistics?.digg_count ?? 0,
            commentCount: item.statistics?.comment_count ?? 0,
            shareCount: item.statistics?.share_count ?? 0,
            collectCount: item.statistics?.collect_count ?? 0,
          },
          coverUrl: item.cover_url || '',
          videoUrl: item.video_url || '',
          status: item.status ?? 0,
          isScheduled: item.is_scheduled ?? false,
          scheduledPublishTime: item.scheduled_publish_time,
        });
      }
    }

    cursor = data.cursor;
    hasMore = data.has_more;
  }

  return {
    posts: allPosts,
    totalFetched: allPosts.length,
    hasMore,
  };
}

// ============================================================================
// Account Analytics
// ============================================================================

interface InsightResponse {
  status_code: number;
  status_msg: string;
  vv_history?: Array<{ status: number; value?: number; date_key?: string }>;
  pv_history?: Array<{ status: number; value?: number; date_key?: string }>;
  like_history?: Array<{ status: number; value?: number; date_key?: string }>;
  comment_history?: Array<{
    status: number;
    value?: number;
    date_key?: string;
  }>;
  share_history?: Array<{ status: number; value?: number; date_key?: string }>;
  follower_num_history?: Array<{
    status: number;
    value?: number;
    date_key?: string;
  }>;
  reached_audience_history?: Array<{
    status: number;
    value?: number;
    date_key?: string;
  }>;
  follower_num?: { status: number; value?: number };
}

/**
 * Get account-level analytics for a date range.
 * Returns daily time series for views, profile views, likes, comments, shares, and followers.
 */
export async function getAccountAnalytics(params: {
  csrfToken: string;
  deviceId: string;
  region: string;
  language: string;
  days?: number;
}): Promise<GetAccountAnalyticsOutput> {
  const common: CommonParams = {
    deviceId: params.deviceId,
    region: params.region,
    language: params.language,
  };
  const days = params.days ?? 28;
  const endDays = 2;
  const tzOffset = new Date().getTimezoneOffset() * -60;

  const typeRequests = [
    { insigh_type: 'vv_history', days: days * 2 - 1, end_days: endDays },
    { insigh_type: 'pv_history', days: days * 2 - 1, end_days: endDays },
    { insigh_type: 'like_history', days: days * 2 - 1, end_days: endDays },
    { insigh_type: 'comment_history', days: days * 2 - 1, end_days: endDays },
    { insigh_type: 'share_history', days: days * 2 - 1, end_days: endDays },
    {
      insigh_type: 'follower_num_history',
      days: days * 2 - 1,
      end_days: endDays,
    },
    {
      insigh_type: 'reached_audience_history',
      days: days * 2 - 1,
      end_days: endDays,
    },
  ];

  const url = buildApiUrl('/aweme/v2/data/insight/', common, {
    tz_offset: String(tzOffset),
    type_requests: JSON.stringify(typeRequests),
  });

  const data = await apiGet<InsightResponse>(url);

  const followerUrl = buildApiUrl('/aweme/v2/data/insight/', common, {
    tz_offset: String(tzOffset),
    type_requests: JSON.stringify([{ insigh_type: 'follower_num' }]),
  });

  const followerData = await apiGet<InsightResponse>(followerUrl);
  const followerCount =
    followerData.follower_num?.status === 0
      ? (followerData.follower_num.value ?? 0)
      : 0;

  return {
    followerCount,
    videoViews: parseHistoryArray(data.vv_history),
    profileViews: parseHistoryArray(data.pv_history),
    likes: parseHistoryArray(data.like_history),
    comments: parseHistoryArray(data.comment_history),
    shares: parseHistoryArray(data.share_history),
    followers: parseHistoryArray(data.follower_num_history),
    reachedAudience: parseHistoryArray(data.reached_audience_history),
    period: { days, endDays },
  };
}

// ============================================================================
// Per-Video Analytics
// ============================================================================

interface VideoInsightResponse {
  status_code: number;
  status_msg: string;
  video_vv_history_7d?: Array<{
    status: number;
    value?: number;
    date_key?: string;
  }>;
  video_like_history_7d?: Array<{
    status: number;
    value?: number;
    date_key?: string;
  }>;
  video_comment_history_7d?: Array<{
    status: number;
    value?: number;
    date_key?: string;
  }>;
  video_shares_history_7d?: Array<{
    status: number;
    value?: number;
    date_key?: string;
  }>;
  video_favorites_history_7d?: Array<{
    status: number;
    value?: number;
    date_key?: string;
  }>;
  video_finish_rate_history_7d?: Array<{
    status: number;
    value?: number;
    date_key?: string;
  }>;
  video_new_followers_history_7d?: Array<{
    status: number;
    value?: number;
    date_key?: string;
  }>;
  video_vv_history_48_hours?: Array<{
    status: number;
    value?: number;
    date_key?: string;
  }>;
  previous_video_vv_history_7d?: Array<{
    status: number;
    value?: number;
    date_key?: string;
  }>;
}

/**
 * Get detailed per-video analytics for a specific TikTok post.
 */
export async function getPostAnalytics(params: {
  csrfToken: string;
  deviceId: string;
  region: string;
  language: string;
  itemId: string;
}): Promise<GetPostAnalyticsOutput> {
  const common: CommonParams = {
    deviceId: params.deviceId,
    region: params.region,
    language: params.language,
  };
  const tzOffset = new Date().getTimezoneOffset() * -60;

  const typeRequests = [
    { insigh_type: 'video_vv_history_7d', days: 7, end_days: 0 },
    { insigh_type: 'video_like_history_7d', days: 7, end_days: 0 },
    { insigh_type: 'video_comment_history_7d', days: 7, end_days: 0 },
    { insigh_type: 'video_shares_history_7d', days: 7, end_days: 0 },
    { insigh_type: 'video_favorites_history_7d', days: 7, end_days: 0 },
    { insigh_type: 'video_finish_rate_history_7d', days: 7, end_days: 0 },
    { insigh_type: 'video_new_followers_history_7d', days: 7, end_days: 0 },
    { insigh_type: 'video_vv_history_48_hours', days: 2, end_days: 0 },
    { insigh_type: 'previous_video_vv_history_7d', days: 7, end_days: 0 },
  ];

  const url = buildApiUrl('/aweme/v2/data/insight/', common, {
    tz_offset: String(tzOffset),
    type_requests: JSON.stringify(typeRequests),
    item_id: params.itemId,
  });

  const data = await apiGet<VideoInsightResponse>(url);

  return {
    itemId: params.itemId,
    videoViews: parseHistoryArray(data.video_vv_history_7d),
    likes: parseHistoryArray(data.video_like_history_7d),
    comments: parseHistoryArray(data.video_comment_history_7d),
    shares: parseHistoryArray(data.video_shares_history_7d),
    favorites: parseHistoryArray(data.video_favorites_history_7d),
    completionRate: parseHistoryArray(data.video_finish_rate_history_7d),
    newFollowers: parseHistoryArray(data.video_new_followers_history_7d),
    views48h: parseHistoryArray(data.video_vv_history_48_hours),
    previousVideoViews7d: parseHistoryArray(data.previous_video_vv_history_7d),
  };
}

// ============================================================================
// Audience Insights
// ============================================================================

interface AudienceInsightResponse {
  status_code: number;
  status_msg: string;
  follower_active_history_days?: Array<{
    status: number;
    value?: number;
    date_key?: string;
  }>;
  follower_active_history_hours?: Array<{
    status: number;
    value?: number;
    date_key?: string;
  }>;
  reached_audience_history?: Array<{
    status: number;
    value?: number;
    date_key?: string;
  }>;
  unique_viewer_num?: { status: number; value?: number };
  follower_num?: { status: number; value?: number };
}

/**
 * Get audience insights for the TikTok account.
 */
export async function getAudienceInsights(params: {
  csrfToken: string;
  deviceId: string;
  region: string;
  language: string;
  days?: number;
}): Promise<GetAudienceInsightsOutput> {
  const common: CommonParams = {
    deviceId: params.deviceId,
    region: params.region,
    language: params.language,
  };
  const days = params.days ?? 28;
  const endDays = 2;
  const tzOffset = new Date().getTimezoneOffset() * -60;

  const typeRequests = [
    {
      insigh_type: 'follower_active_history_days',
      days: days * 2 - 1,
      end_days: endDays,
    },
    {
      insigh_type: 'follower_active_history_hours',
      days: days * 2 - 1,
      end_days: endDays,
    },
    {
      insigh_type: 'reached_audience_history',
      days: days * 2 - 1,
      end_days: endDays,
    },
    { insigh_type: 'unique_viewer_num', range: 1 },
    { insigh_type: 'follower_num' },
  ];

  const url = buildApiUrl('/aweme/v2/data/insight/', common, {
    tz_offset: String(tzOffset),
    type_requests: JSON.stringify(typeRequests),
  });

  const data = await apiGet<AudienceInsightResponse>(url);

  const uniqueViewerCount =
    data.unique_viewer_num?.status === 0 &&
    typeof data.unique_viewer_num.value === 'number'
      ? data.unique_viewer_num.value
      : 0;
  const followerCount =
    data.follower_num?.status === 0 &&
    typeof data.follower_num.value === 'number'
      ? data.follower_num.value
      : 0;

  return {
    followerActivityDays: parseHistoryArray(data.follower_active_history_days),
    followerActivityHours: parseHistoryArray(
      data.follower_active_history_hours,
    ),
    reachedAudience: parseHistoryArray(data.reached_audience_history),
    uniqueViewerCount,
    followerCount,
    period: { days, endDays },
  };
}

// ============================================================================
// Follower Growth
// ============================================================================

interface FollowerGrowthResponse {
  status_code: number;
  status_msg: string;
  net_follower_history?: Array<{
    status: number;
    value?: number;
    date_key?: string;
  }>;
  follower_num_history?: Array<{
    status: number;
    value?: number;
    date_key?: string;
  }>;
  follower_num?: { status: number; value?: number };
}

/**
 * Get follower growth over time with daily granularity.
 */
export async function getFollowerGrowth(params: {
  csrfToken: string;
  deviceId: string;
  region: string;
  language: string;
  days?: number;
}): Promise<GetFollowerGrowthOutput> {
  const common: CommonParams = {
    deviceId: params.deviceId,
    region: params.region,
    language: params.language,
  };
  const days = params.days ?? 28;
  const endDays = 2;
  const tzOffset = new Date().getTimezoneOffset() * -60;

  const typeRequests = [
    {
      insigh_type: 'net_follower_history',
      days: days * 2 - 1,
      end_days: endDays,
    },
    {
      insigh_type: 'follower_num_history',
      days: days * 2 - 1,
      end_days: endDays,
    },
    { insigh_type: 'follower_num' },
  ];

  const url = buildApiUrl('/aweme/v2/data/insight/', common, {
    tz_offset: String(tzOffset),
    type_requests: JSON.stringify(typeRequests),
  });

  const data = await apiGet<FollowerGrowthResponse>(url);

  const currentFollowerCount =
    data.follower_num?.status === 0 &&
    typeof data.follower_num.value === 'number'
      ? data.follower_num.value
      : 0;

  const netFollowers = (data.net_follower_history ?? [])
    .filter((item) => item.status === 0)
    .map((item) => ({
      value: item.value ?? 0,
      ...(item.date_key ? { date: item.date_key } : {}),
    }));

  const followerHistory = parseHistoryArray(data.follower_num_history);
  const totalNetGain = netFollowers.reduce((sum, dp) => sum + dp.value, 0);

  return {
    currentFollowerCount,
    netFollowers,
    followerHistory,
    totalNetGain,
    period: { days, endDays },
  };
}

// ============================================================================
// Top Posts
// ============================================================================

const METRIC_FIELD_MAP = {
  views: 'playCount',
  likes: 'diggCount',
  comments: 'commentCount',
  shares: 'shareCount',
  saves: 'collectCount',
} as const;

/**
 * Get top performing posts ranked by a chosen engagement metric.
 */
export async function getTopPosts(params: {
  csrfToken: string;
  deviceId: string;
  region: string;
  language: string;
  metric?: 'views' | 'likes' | 'comments' | 'shares' | 'saves';
  limit?: number;
  maxPages?: number;
}): Promise<GetTopPostsOutput> {
  const common: CommonParams = {
    deviceId: params.deviceId,
    region: params.region,
    language: params.language,
  };
  const metric = params.metric ?? 'views';
  const limit = Math.min(params.limit ?? 10, 50);
  const maxPages = params.maxPages ?? 5;
  const statField = METRIC_FIELD_MAP[metric];

  interface PostEntry {
    itemId: string;
    desc: string;
    postTime: number;
    duration: number;
    stats: {
      playCount: number;
      diggCount: number;
      commentCount: number;
      shareCount: number;
      collectCount: number;
    };
    coverUrl: string;
  }

  const allPosts: PostEntry[] = [];
  let cursor = 0;
  let hasMore = true;

  for (let page = 0; page < maxPages && hasMore; page++) {
    const url = buildApiUrl('/tiktok/creator/manage/item_list/v1/', common);
    const data = await apiPost<ItemListResponse>(url, {
      cursor,
      size: 50,
      query: {
        sort_orders: [{ field_name: 'post_time', order: 2 }],
        conditions: [],
        is_recent_posts: false,
      },
    });

    if (data.item_list) {
      for (const item of data.item_list) {
        allPosts.push({
          itemId: item.item_id,
          desc: item.desc,
          postTime: item.post_time,
          duration: item.duration,
          stats: {
            playCount:
              typeof item.statistics?.play_count === 'number'
                ? item.statistics.play_count
                : 0,
            diggCount:
              typeof item.statistics?.digg_count === 'number'
                ? item.statistics.digg_count
                : 0,
            commentCount:
              typeof item.statistics?.comment_count === 'number'
                ? item.statistics.comment_count
                : 0,
            shareCount:
              typeof item.statistics?.share_count === 'number'
                ? item.statistics.share_count
                : 0,
            collectCount:
              typeof item.statistics?.collect_count === 'number'
                ? item.statistics.collect_count
                : 0,
          },
          coverUrl: item.cover_url ?? '',
        });
      }
    }

    cursor = data.cursor;
    hasMore = data.has_more;
  }

  allPosts.sort((a, b) => b.stats[statField] - a.stats[statField]);
  const topPosts = allPosts.slice(0, limit);

  return {
    posts: topPosts.map((p) => ({
      itemId: p.itemId,
      desc: p.desc,
      postTime: p.postTime,
      duration: p.duration,
      stats: p.stats,
      coverUrl: p.coverUrl,
      rankValue: p.stats[statField],
    })),
    metric,
    totalPostsSearched: allPosts.length,
  };
}

// ============================================================================
// Comments
// ============================================================================

interface CommentsV2Response {
  hasMore: boolean;
  comments: CommentsV2Comment[] | null;
  cursor: string;
}

interface CommentsV2Comment {
  comment_id: string;
  item_id: string;
  text: string;
  create_time: number;
  digg_count: number;
  reply_comment_total: number;
  creator_replied: boolean;
  user: {
    uid: string;
    unique_id: string;
    nickname: string;
    avatar_thumb?: { url_list?: string[] };
    follower_count?: number;
    is_follower?: boolean;
  };
}

interface ItemListForCommentsResponse {
  status_code: number;
  status_msg: string;
  cursor: number;
  has_more: boolean;
  item_list?: Array<{
    item_id: string;
    desc: string;
    statistics?: { comment_count: number };
  }>;
}

interface CommentPublishResponse {
  status_code: number;
  status_msg: string;
  comment?: {
    comment_id?: string;
    cid?: string;
  };
}

interface CommentDeleteResponse {
  status_code: number;
  status_msg: string;
}

/**
 * List comments on your TikTok posts.
 */
export async function listComments(params: {
  csrfToken: string;
  deviceId: string;
  region: string;
  language: string;
  itemId?: string;
  replyStatus?: 0 | 1 | 2;
  followerStatus?: 0 | 1 | 2;
  keyword?: string;
  startDate?: number;
  endDate?: number;
  maxPages?: number;
}): Promise<ListCommentsOutput> {
  const common: CommonParams = {
    deviceId: params.deviceId,
    region: params.region,
    language: params.language,
  };

  const now = Math.floor(Date.now() / 1000);
  const startDate = params.startDate ?? now - 30 * 24 * 3600;
  const endDate = params.endDate ?? now;
  const maxPages = params.maxPages ?? 5;

  const filterConditions: Array<{
    fieldName: string;
    operator: string;
    value: string;
  }> = [];

  if (params.itemId) {
    filterConditions.push({
      fieldName: 'item_id',
      operator: 'EQ',
      value: params.itemId,
    });
  }

  if (params.replyStatus !== undefined && params.replyStatus !== 0) {
    filterConditions.push({
      fieldName: 'creator_replied',
      operator: 'EQ',
      value: String(params.replyStatus),
    });
  }

  if (params.followerStatus !== undefined && params.followerStatus !== 0) {
    filterConditions.push({
      fieldName: 'is_follower',
      operator: 'EQ',
      value: String(params.followerStatus),
    });
  }

  const searchConditions: Array<{
    fieldName: string;
    operator: string;
    value: string;
  }> = [];
  if (params.keyword) {
    searchConditions.push({
      fieldName: 'text',
      operator: 'CONTAINS',
      value: params.keyword,
    });
  }

  const allComments: ListCommentsOutput['comments'] = [];
  let cursor = '';
  let hasMore = true;

  for (let page = 0; page < maxPages && hasMore; page++) {
    const url = buildApiUrl('/tiktokstudio/api/web/commentsV2', common);
    const body: Record<string, unknown> = {
      count: '20',
      query: {
        searchConditions,
        filterConditions,
        sortOrders: [{ fieldName: 'create_time', order: 2 }],
      },
      dateRange: {
        startDate: String(startDate),
        endDate: String(endDate),
      },
    };

    if (cursor) {
      body.cursor = cursor;
    }

    const data = await apiPost<CommentsV2Response>(url, body);

    if (data.comments) {
      for (const c of data.comments) {
        const avatarUrl = c.user?.avatar_thumb?.url_list?.[0];
        allComments.push({
          commentId: c.comment_id,
          itemId: c.item_id,
          text: c.text,
          createTime: c.create_time,
          diggCount: c.digg_count,
          replyCount: c.reply_comment_total,
          creatorReplied: Boolean(c.creator_replied),
          author: {
            uid: c.user.uid,
            uniqueId: c.user.unique_id,
            nickname: c.user.nickname,
            ...(avatarUrl !== undefined ? { avatarUrl } : {}),
            ...(c.user.follower_count !== undefined
              ? { followerCount: c.user.follower_count }
              : {}),
            ...(c.user.is_follower !== undefined
              ? { isFollower: Boolean(c.user.is_follower) }
              : {}),
          },
        });
      }
    }

    hasMore = data.hasMore && data.cursor !== '';
    cursor = data.cursor;
  }

  return {
    comments: allComments,
    totalFetched: allComments.length,
    hasMore,
  };
}

/**
 * Get total comment counts across your posts.
 */
export async function getCommentCount(params: {
  csrfToken: string;
  deviceId: string;
  region: string;
  language: string;
}): Promise<GetCommentCountOutput> {
  const common: CommonParams = {
    deviceId: params.deviceId,
    region: params.region,
    language: params.language,
  };

  const allPosts: Array<{
    item_id: string;
    desc: string;
    comment_count: number;
  }> = [];
  let cursor = 0;
  let hasMore = true;
  let page = 0;
  const maxPages = 10;

  while (hasMore && page < maxPages) {
    const url = buildApiUrl('/tiktok/creator/manage/item_list/v1/', common);
    const data = await apiPost<ItemListForCommentsResponse>(url, {
      cursor,
      size: 50,
      query: {
        sort_orders: [{ field_name: 'post_time', order: 2 }],
        conditions: [],
        is_recent_posts: false,
      },
    });

    if (data.item_list) {
      for (const item of data.item_list) {
        if (item.statistics !== undefined) {
          allPosts.push({
            item_id: item.item_id,
            desc: item.desc,
            comment_count: item.statistics.comment_count,
          });
        }
      }
    }

    cursor = data.cursor;
    hasMore = data.has_more;
    page++;
  }

  allPosts.sort((a, b) => b.comment_count - a.comment_count);

  const totalComments = allPosts.reduce((sum, p) => sum + p.comment_count, 0);
  const postsWithComments = allPosts.filter((p) => p.comment_count > 0).length;

  return {
    totalComments,
    postsWithComments,
    perPost: allPosts.map((p) => ({
      itemId: p.item_id,
      desc: p.desc,
      commentCount: p.comment_count,
    })),
  };
}

/**
 * Reply to a specific comment on one of your TikTok posts.
 */
export async function replyToComment(params: {
  csrfToken: string;
  deviceId: string;
  region: string;
  language: string;
  itemId: string;
  commentId: string;
  text: string;
}): Promise<ReplyToCommentOutput> {
  const common: CommonParams = {
    deviceId: params.deviceId,
    region: params.region,
    language: params.language,
  };

  const url = buildApiUrl('/api/comment/publish/', common);
  const data = await apiPostForm<CommentPublishResponse>(url, {
    aweme_id: params.itemId,
    text: params.text,
    reply_id: params.commentId,
  });

  const replyId =
    data.comment?.comment_id !== undefined
      ? data.comment.comment_id
      : data.comment?.cid;

  return {
    success: true,
    ...(replyId !== undefined ? { replyCommentId: replyId } : {}),
  };
}

/**
 * Delete a single comment from one of your TikTok posts.
 */
export async function deleteComment(params: {
  csrfToken: string;
  deviceId: string;
  region: string;
  language: string;
  commentId: string;
}): Promise<DeleteCommentOutput> {
  const common: CommonParams = {
    deviceId: params.deviceId,
    region: params.region,
    language: params.language,
  };

  const url = buildApiUrl('/api/comment/delete/', common);
  await apiPostForm<CommentDeleteResponse>(url, {
    cid: params.commentId,
    action: '1',
  });

  return { success: true };
}

/**
 * Bulk delete multiple comments.
 */
export async function deleteComments(params: {
  csrfToken: string;
  deviceId: string;
  region: string;
  language: string;
  commentIds: string[];
}): Promise<{ success: boolean; deletedCount: number }> {
  const common: CommonParams = {
    deviceId: params.deviceId,
    region: params.region,
    language: params.language,
  };
  let deletedCount = 0;
  for (const cid of params.commentIds) {
    const url = buildApiUrl('/api/comment/delete/', common);
    await apiPostForm<CommentDeleteResponse>(url, { cid, action: '1' });
    deletedCount++;
  }
  return { success: true, deletedCount };
}

/**
 * Pin a comment on one of your TikTok posts.
 */
export async function pinComment(params: {
  csrfToken: string;
  deviceId: string;
  region: string;
  language: string;
  commentId: string;
  itemId: string;
}): Promise<{ success: boolean }> {
  const common: CommonParams = {
    deviceId: params.deviceId,
    region: params.region,
    language: params.language,
  };
  const url = buildApiUrl('/api/comment/stick/', common);
  await apiPostForm<{ status_code: number; status_msg: string }>(url, {
    cid: params.commentId,
    aweme_id: params.itemId,
    action: '1',
  });
  return { success: true };
}

/**
 * Unpin a previously pinned comment on one of your TikTok posts.
 */
export async function unpinComment(params: {
  csrfToken: string;
  deviceId: string;
  region: string;
  language: string;
  commentId: string;
  itemId: string;
}): Promise<{ success: boolean }> {
  const common: CommonParams = {
    deviceId: params.deviceId,
    region: params.region,
    language: params.language,
  };
  const url = buildApiUrl('/api/comment/stick/', common);
  await apiPostForm<{ status_code: number; status_msg: string }>(url, {
    cid: params.commentId,
    aweme_id: params.itemId,
    action: '0',
  });
  return { success: true };
}

// ============================================================================
// Discovery / Trends
// ============================================================================

interface TrendingVideoResponse {
  BaseResp?: { StatusCode: number; StatusMessage?: string };
  HasMore: boolean;
  Total: number;
  PageNum: number;
  PageSize: number;
  TrendingVideos?: Array<{
    CoverUrl: string;
    ItemId: string;
    ItemName: string;
    LikeCount: number;
    NickName: string;
    PlayAddress?: string[];
    PlayCount: number;
    SecUid: string;
    UniqueId: string;
  }>;
}

/**
 * Get trending TikTok videos from the Inspiration page.
 */
export async function getTrendingPosts(params: {
  csrfToken: string;
  deviceId: string;
  region: string;
  language: string;
  filterRegion?: string;
  filterCategory?: string;
  pageNum?: number;
  pageSize?: number;
}): Promise<GetTrendingPostsOutput> {
  const common: CommonParams = {
    deviceId: params.deviceId,
    region: params.region,
    language: params.language,
  };

  const filterRegion = params.filterRegion ?? 'All';
  const filterCategory = params.filterCategory ?? 'All';
  const pageNum = params.pageNum ?? 0;
  const pageSize = params.pageSize ?? 12;

  const url = buildApiUrl(
    '/creator_studio/inspiration/trending/video/v2',
    common,
    {
      ...getBrowserContextParams(),
      key: `trendingList${filterRegion}${filterCategory}`,
      PageNum: String(pageNum),
      PageSize: String(pageSize),
      Region: filterRegion,
      Vertical: filterCategory,
      OpRegion: params.region,
      TrendingType: '0',
    },
  );

  const data = await apiGet<TrendingVideoResponse>(url);

  return {
    posts: (data.TrendingVideos ?? []).map((v) => ({
      itemId: v.ItemId,
      title: v.ItemName,
      authorUniqueId: v.UniqueId,
      authorNickName: v.NickName,
      authorSecUid: v.SecUid,
      coverUrl: v.CoverUrl,
      playCount: v.PlayCount,
      likeCount: v.LikeCount,
      playAddress: v.PlayAddress?.[0],
    })),
    totalCount: data.Total,
    hasMore: data.HasMore,
    pageNum: data.PageNum,
  };
}

interface TrendingSoundsApiResponse {
  status_code: number;
  status_msg: string | null;
  data: {
    has_more: boolean;
    total: number;
    music_list: Array<{
      id: number;
      id_str: string;
      title: string;
      author: string;
      duration: number;
      language: string;
      user_count: number;
      cover_medium?: { url_list?: string[] };
      play_url?: { url_list?: string[] };
    }>;
  };
}

/**
 * Get trending sounds/music from the TikTok Creator Sound Library.
 */
export async function getTrendingSounds(params: {
  csrfToken: string;
  deviceId: string;
  region: string;
  language: string;
  pageNum?: number;
  pageSize?: number;
}): Promise<GetTrendingSoundsOutput> {
  const pageNum = params.pageNum ?? 1;
  const pageSize = params.pageSize ?? 20;

  const data = await apiPost<TrendingSoundsApiResponse>(
    '/tiktok/v1/creator/music/unlimited/list/?aid=1988',
    { page_num: pageNum, page_size: pageSize, source: 1 },
  );

  return {
    sounds: data.data.music_list.map((m) => ({
      id: m.id_str,
      title: m.title,
      author: m.author,
      duration: m.duration,
      language: m.language,
      userCount: m.user_count,
      coverUrl: m.cover_medium?.url_list?.[0],
      playUrl: m.play_url?.url_list?.[0],
    })),
    total: data.data.total,
    hasMore: data.data.has_more,
  };
}

interface TrendingTopicsResponse {
  BaseResp?: { StatusCode: number; StatusMessage?: string };
  HasMore: boolean;
  Total: number;
  Cursor: number;
  TrendingTopics?: Array<{
    Title: string;
    Id: string;
    Play: number | string;
    Rank: number;
    Desc: string;
    CoverOrigin: string | string[];
    ScoreSeries?: Array<{ Timestamp: number | string; Value: number | string }>;
    Extra?: Array<{
      ItemId: string;
      ItemName: string;
      LikeCount: number | string;
      PlayCount: number | string;
    }>;
  }>;
}

/**
 * Get trending hashtags/topics from TikTok with view counts and trend trajectories.
 */
export async function getTrendingHashtags(params: {
  csrfToken: string;
  deviceId: string;
  region: string;
  language: string;
  filterRegion?: string;
  filterCategory?: string;
  count?: number;
  cursor?: number;
}): Promise<GetTrendingHashtagsOutput> {
  const common: CommonParams = {
    deviceId: params.deviceId,
    region: params.region,
    language: params.language,
  };

  const filterRegion = params.filterRegion ?? 'All';
  const filterCategory = params.filterCategory ?? 'All';
  const count = params.count ?? 15;
  const cursor = params.cursor ?? 0;

  const url = buildApiUrl(
    '/creator_studio/inspiration/trending/topic/v1',
    common,
    {
      ...getBrowserContextParams(),
      Region: filterRegion,
      Vertical: filterCategory,
      Cursor: String(cursor),
      Count: String(count),
      OpRegion: params.region,
    },
  );

  const data = await apiGet<TrendingTopicsResponse>(url);

  return {
    hashtags: (data.TrendingTopics ?? []).map((t) => ({
      id: t.Id,
      title: t.Title,
      viewCount: Number(t.Play),
      rank: t.Rank,
      description: t.Desc,
      coverUrl: Array.isArray(t.CoverOrigin) ? t.CoverOrigin[0] : t.CoverOrigin,
      scoreHistory: (t.ScoreSeries ?? []).map((s) => ({
        timestamp: Number(s.Timestamp),
        value: Number(s.Value),
      })),
      relatedVideos: (t.Extra ?? []).map((e) => ({
        itemId: e.ItemId,
        title: e.ItemName,
        likeCount: Number(e.LikeCount),
        playCount: Number(e.PlayCount),
      })),
    })),
    total: data.Total,
    hasMore: data.HasMore,
    cursor: data.Cursor,
  };
}

// ============================================================================
// Profile
// ============================================================================

interface UserProfileResponse {
  statusCode: number;
  userBaseInfo?: {
    UserProfile?: {
      UserBase?: {
        Id?: string;
        SecUid?: string;
        UniqId?: string;
        NickName?: string;
        CertInfo?: { HasCert?: boolean };
        AvatarUris?: Record<string, string>;
        Region?: { Region?: string };
        Language?: { Language?: string };
      };
      ProfileBase?: {
        Bio?: { Description?: string; Pronouns?: string };
      };
      UserStatus?: {
        PrivateType?: number;
      };
    };
    BaseResp?: { StatusCode?: number; StatusMessage?: string };
  };
  userExtra?: {
    isPrivate?: boolean;
  };
}

/**
 * Get the authenticated user's TikTok profile info.
 */
export async function getProfile(
  params: GetProfileInput,
): Promise<GetProfileOutput> {
  const common: CommonParams = {
    deviceId: params.deviceId,
    region: params.region,
    language: params.language,
  };

  const url = buildApiUrl('/tiktokstudio/api/web/user', common);
  const data = await apiGet<UserProfileResponse>(url);

  if (data.statusCode !== 0) {
    throw new UpstreamError(
      `TikTok profile error: statusCode=${data.statusCode}. URL: ${url}`,
    );
  }

  const profile = data.userBaseInfo?.UserProfile;
  if (!profile) {
    throw new ContractDrift('Profile data not found in response. URL: ' + url);
  }

  const base = profile.UserBase;
  if (!base) {
    throw new ContractDrift('UserBase not found in profile response. URL: ' + url);
  }
  if (!base.Id) {
    throw new ContractDrift('User ID not found in profile response. URL: ' + url);
  }
  if (!base.UniqId) {
    throw new ContractDrift(
      'Username (UniqId) not found in profile response. URL: ' + url,
    );
  }

  const bio = profile.ProfileBase?.Bio;
  const status = profile.UserStatus;

  const avatarUris = base.AvatarUris;
  const rawAvatar = avatarUris
    ? avatarUris['1'] || avatarUris['3'] || avatarUris['6']
    : undefined;
  let resolvedAvatarUrl = '';
  if (rawAvatar) {
    resolvedAvatarUrl = rawAvatar.startsWith('http')
      ? rawAvatar
      : `https://p19-common-sign.tiktokcdn-us.com/${rawAvatar}`;
  }

  const isPrivateFromExtra = data.userExtra?.isPrivate;
  const isPrivate =
    isPrivateFromExtra !== undefined
      ? isPrivateFromExtra
      : status?.PrivateType !== undefined
        ? status.PrivateType !== 0
        : false;

  const regionCode = base.Region?.Region;

  return {
    uid: base.Id,
    secUid: strOrEmpty(base.SecUid),
    uniqueId: base.UniqId,
    nickName: base.NickName ? base.NickName : base.UniqId,
    bio: strOrEmpty(bio?.Description),
    pronouns: strOrEmpty(bio?.Pronouns),
    avatarUrl: resolvedAvatarUrl,
    isVerified: Boolean(base.CertInfo?.HasCert),
    isPrivate,
    region: regionCode ? regionCode : params.region,
    language: params.language,
  };
}

interface CommitUserEditResponse {
  status_code: number;
  status_msg: string;
}

/**
 * Update profile fields: display name and/or bio.
 */
export async function updateProfile(
  params: UpdateProfileInput,
): Promise<UpdateProfileOutput> {
  const common: CommonParams = {
    deviceId: params.deviceId,
    region: params.region,
    language: params.language,
  };

  if (!params.nickName && !params.bio) {
    throw new Validation(
      'updateProfile: provide at least one field to update (nickName or bio)',
    );
  }

  const body: Record<string, string> = {};
  if (params.nickName !== undefined) body.nickname = params.nickName;
  if (params.bio !== undefined) body.signature = params.bio;

  const url = buildApiUrl('/api/commit/user/edit/', common);
  const data = await apiPost<CommitUserEditResponse>(
    url,
    body,
    params.csrfToken,
  );

  if (data.status_code !== 0) {
    throw new UpstreamError(
      `TikTok update profile error: status_code=${data.status_code}, msg="${data.status_msg}". URL: ${url}`,
    );
  }

  return { success: true };
}

// ============================================================================
// Monetization
// ============================================================================

interface MoneyAmount {
  currency?: { code?: string; symbol?: string };
  formatted?: string;
  formatted_no_symbol?: string;
  units?: number;
  nanos?: number;
}

interface RewardAnalyticsProgram {
  name?: string;
  m10n_project?: number;
  description?: string;
  requirements_met?: number;
  total_requirements?: number;
  web_page_info?: { status?: boolean; button_text?: string };
}

interface RewardAnalyticsResponse {
  status_code: number;
  status_msg: string;
  daily_estimated_income?: Array<{
    money?: MoneyAmount;
    time?: number;
  }>;
  seven_d_income?: MoneyAmount;
  thirty_d_income?: MoneyAmount;
  sixty_d_income?: MoneyAmount;
  seven_d_over_seven_d_pct?: number;
  thirty_d_over_thirty_d_pct?: number;
  sixty_d_over_sixty_d_pct?: number;
  selected_currency?: { code?: string };
  m10n_programs_for_you?: RewardAnalyticsProgram[];
}

async function fetchRewardAnalytics(params: {
  deviceId: string;
  region: string;
  language: string;
}): Promise<RewardAnalyticsResponse> {
  const common: CommonParams = {
    deviceId: params.deviceId,
    region: params.region,
    language: params.language,
  };
  const url = buildApiUrl(
    '/tiktok/v1/creator/m10n_center/reward_analytics',
    common,
  );
  const data = await apiGet<RewardAnalyticsResponse>(url);

  if (data.status_code !== 0) {
    throw new UpstreamError(
      `TikTok reward analytics error: status_code=${data.status_code}, msg="${data.status_msg}". URL: ${url}`,
    );
  }

  return data;
}

function formatMoney(amount: MoneyAmount | undefined): string {
  if (!amount) return '$0.00';
  return amount.formatted ? amount.formatted : '$0.00';
}

/**
 * Get Creator Rewards Program earnings summary.
 */
export async function getEarnings(
  params: GetEarningsInput,
): Promise<GetEarningsOutput> {
  const data = await fetchRewardAnalytics(params);

  const selectedCode = data.selected_currency?.code;
  const incomeCode = data.seven_d_income?.currency?.code;
  const currency = selectedCode
    ? selectedCode
    : incomeCode
      ? incomeCode
      : 'USD';

  const rawHistory = data.daily_estimated_income;
  const dailyHistory = rawHistory
    ? rawHistory.map((entry) => ({
        time: numOrZero(entry.time),
        amount: formatMoney(entry.money),
        amountRaw: numOrZero(entry.money?.units),
      }))
    : [];

  return {
    currency,
    sevenDayTotal: formatMoney(data.seven_d_income),
    thirtyDayTotal: formatMoney(data.thirty_d_income),
    sixtyDayTotal: formatMoney(data.sixty_d_income),
    sevenDayChangePercent: numOrZero(data.seven_d_over_seven_d_pct),
    thirtyDayChangePercent: numOrZero(data.thirty_d_over_thirty_d_pct),
    sixtyDayChangePercent: numOrZero(data.sixty_d_over_sixty_d_pct),
    dailyHistory,
  };
}

/**
 * Get monetization program eligibility status.
 */
export async function getMonetizationStatus(
  params: GetMonetizationStatusInput,
): Promise<GetMonetizationStatusOutput> {
  const data = await fetchRewardAnalytics(params);

  const rawPrograms = data.m10n_programs_for_you;
  const programs = rawPrograms
    ? rawPrograms.map((prog) => {
        const ctaText = prog.web_page_info?.button_text
          ? prog.web_page_info.button_text
          : strOrEmpty(prog.name);
        return {
          name: strOrEmpty(prog.name),
          m10nProject: numOrZero(prog.m10n_project),
          description: strOrEmpty(prog.description),
          requirementsMet: numOrZero(prog.requirements_met),
          totalRequirements: numOrZero(prog.total_requirements),
          isEligible: prog.web_page_info?.status === true,
          ctaText,
        };
      })
    : [];

  return { programs };
}

// ============================================================================
// Content Management
// ============================================================================

interface ContentItemListItem {
  item_id?: string;
  desc?: string;
  create_time?: number;
  post_time?: number;
  duration?: number;
  statistics?: {
    play_count?: number;
    digg_count?: number;
    comment_count?: number;
    share_count?: number;
    collect_count?: number;
  };
  cover_url?: string;
  video_url?: string;
  status?: number;
  is_scheduled?: boolean;
  scheduled_publish_time?: number;
}

interface ContentItemListResponse {
  status_code: number;
  status_msg: string;
  cursor?: number;
  has_more?: boolean;
  item_list?: ContentItemListItem[];
}

/**
 * Get detailed information for a single post by item ID.
 */
export async function getPost(params: GetPostInput): Promise<GetPostOutput> {
  const common: CommonParams = {
    deviceId: params.deviceId,
    region: params.region,
    language: params.language,
  };

  const url = buildApiUrl('/tiktok/creator/manage/item_list/v1/', common);
  const data = await apiPost<ContentItemListResponse>(url, {
    cursor: 0,
    size: 1,
    query: {
      sort_orders: [{ field_name: 'post_time', order: 2 }],
      conditions: [
        { field_name: 'item_id', filter_value: params.itemId, operate: 1 },
      ],
      is_recent_posts: false,
    },
  });

  const items = data.item_list;
  if (!items || items.length === 0) {
    return { post: null };
  }

  const item = items[0];
  if (!item || !item.item_id) {
    return { post: null };
  }

  return {
    post: {
      itemId: item.item_id,
      desc: strOrEmpty(item.desc),
      createTime: numOrZero(item.create_time),
      postTime: numOrZero(item.post_time),
      duration: numOrZero(item.duration),
      stats: {
        playCount: numOrZero(item.statistics?.play_count),
        diggCount: numOrZero(item.statistics?.digg_count),
        commentCount: numOrZero(item.statistics?.comment_count),
        shareCount: numOrZero(item.statistics?.share_count),
        collectCount: numOrZero(item.statistics?.collect_count),
      },
      coverUrl: strOrEmpty(item.cover_url),
      videoUrl: strOrEmpty(item.video_url),
      status: numOrZero(item.status),
      isScheduled: Boolean(item.is_scheduled),
      scheduledPublishTime: item.scheduled_publish_time,
    },
  };
}

/**
 * Get all draft posts stored in TikTok Studio.
 */
export async function listDrafts(
  params: ListDraftsInput,
): Promise<ListDraftsOutput> {
  const common: CommonParams = {
    deviceId: params.deviceId,
    region: params.region,
    language: params.language,
  };

  const url = buildApiUrl('/tiktok/creator/manage/item_list/v1/', common);
  const data = await apiPost<ContentItemListResponse>(url, {
    cursor: 0,
    size: 50,
    query: {
      sort_orders: [{ field_name: 'create_time', order: 2 }],
      conditions: [],
      is_recent_posts: false,
      is_draft: true,
    },
  });

  const items = data.item_list;
  if (!items || items.length === 0) {
    return { drafts: [], totalFetched: 0 };
  }

  const drafts = items
    .filter((item): item is ContentItemListItem & { item_id: string } =>
      Boolean(item.item_id),
    )
    .map((item) => ({
      itemId: item.item_id,
      desc: strOrEmpty(item.desc),
      createTime: numOrZero(item.create_time),
      duration: numOrZero(item.duration),
      coverUrl: strOrEmpty(item.cover_url),
    }));

  return { drafts, totalFetched: drafts.length };
}

interface DeleteItemResponse {
  status_code: number;
  status_msg: string;
}

/**
 * Delete a published or scheduled post.
 */
export async function deletePost(
  params: DeletePostInput,
): Promise<DeletePostOutput> {
  const common: CommonParams = {
    deviceId: params.deviceId,
    region: params.region,
    language: params.language,
  };

  const url = buildApiUrl('/api/item/delete/', common);
  await apiPost<DeleteItemResponse>(
    url,
    { item_id: params.itemId },
    params.csrfToken,
  );

  return { success: true };
}

interface UpdateItemResponse {
  status_code: number;
  status_msg: string;
}

/**
 * Edit post settings after publishing: caption, privacy, and interaction toggles.
 */
export async function updatePost(
  params: UpdatePostInput,
): Promise<UpdatePostOutput> {
  const common: CommonParams = {
    deviceId: params.deviceId,
    region: params.region,
    language: params.language,
  };

  const body: Record<string, unknown> = { item_id: params.itemId };
  if (params.desc !== undefined) body.desc = params.desc;
  if (params.privacyLevel !== undefined)
    body.privacy_level = params.privacyLevel;
  if (params.allowComment !== undefined)
    body.allow_comment = params.allowComment ? 1 : 0;
  if (params.allowDuet !== undefined)
    body.allow_duet = params.allowDuet ? 1 : 0;
  if (params.allowStitch !== undefined)
    body.allow_stitch = params.allowStitch ? 1 : 0;

  const url = buildApiUrl('/api/item/update/', common);
  await apiPost<UpdateItemResponse>(url, body, params.csrfToken);

  return { success: true };
}
