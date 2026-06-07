import { getViewerUserId, graphql } from './helpers';
import type {
  ListHomeFeedInput,
  ListHomeFeedOutput,
  ListStoriesInput,
  GetRightSideCardsInput,
  GetMegaphoneInput,
  GetPostPermalinkInput,
  FeedResponse,
  FeedItemEntry,
  GetCachedFeedItemInput,
  GetCachedFeedItemOutput,
} from './schemas-feed';

const FEED_SHARED_VARIABLES = {
  RELAY_INCREMENTAL_DELIVERY: true,
  connectionClass: 'EXCELLENT',
  feedLocation: 'NEWSFEED',
  feedStyle: 'DEFAULT',
  feedbackSource: 1,
  privacySelectorRenderLocation: 'COMET_STREAM',
  recentVPVs: [],
  refreshMode: 'COLD_START',
  renderLocation: 'homepage_stream',
  scale: 1,
  shouldChangeBRSLabelFieldName: false,
  shouldObfuscateCategoryField: true,
  shouldUseBRSLabelFieldNameV1: false,
  shouldUseBRSLabelFieldNameV2: false,
  useDefaultActor: false,
  __relay_internal__pv__GHLShouldChangeSponsoredAuctionDistanceFieldNamerelayprovider: true,
  __relay_internal__pv__GHLShouldUseSponsoredAuctionLabelFieldNameV1relayprovider: false,
  __relay_internal__pv__GHLShouldUseSponsoredAuctionLabelFieldNameV2relayprovider: true,
  __relay_internal__pv__GHLShouldChangeSponsoredDataFieldNamerelayprovider: true,
  __relay_internal__pv__GHLShouldChangeAdIdFieldNamerelayprovider: true,
  __relay_internal__pv__CometFeedStory_enable_reactor_facepilerelayprovider: false,
  __relay_internal__pv__CometFeedStory_enable_post_permalink_white_space_clickrelayprovider: false,
  __relay_internal__pv__CometUFICommentActionLinksRewriteEnabledrelayprovider: false,
  __relay_internal__pv__CometUFICommentAvatarStickerAnimatedImagerelayprovider: false,
  __relay_internal__pv__IsWorkUserrelayprovider: false,
  __relay_internal__pv__TestPilotShouldIncludeDemoAdUseCaserelayprovider: false,
  __relay_internal__pv__FBReels_deprecate_short_form_video_context_gkrelayprovider: true,
  __relay_internal__pv__FBReels_enable_view_dubbed_audio_type_gkrelayprovider: true,
  __relay_internal__pv__CometImmersivePhotoCanUserDisable3DMotionrelayprovider: false,
  __relay_internal__pv__WorkCometIsEmployeeGKProviderrelayprovider: false,
  __relay_internal__pv__IsMergQAPollsrelayprovider: false,
  __relay_internal__pv__FBReelsMediaFooter_comet_enable_reels_ads_gkrelayprovider: true,
  __relay_internal__pv__CometUFIReactionsEnableShortNamerelayprovider: false,
  __relay_internal__pv__CometUFICommentAutoTranslationTyperelayprovider:
    'ORIGINAL',
  __relay_internal__pv__CometUFIShareActionMigrationrelayprovider: true,
  __relay_internal__pv__CometUFISingleLineUFIrelayprovider: true,
  __relay_internal__pv__CometUFI_dedicated_comment_routable_dialog_gkrelayprovider: true,
  __relay_internal__pv__FBReelsIFUTileContent_reelsIFUPlayOnHoverrelayprovider: true,
  __relay_internal__pv__GroupsCometGYSJFeedItemHeightrelayprovider: 206,
  __relay_internal__pv__ShouldEnableBakedInTextStoriesrelayprovider: false,
  __relay_internal__pv__StoriesShouldIncludeFbNotesrelayprovider: true,
};

interface RawNewsFeedNode {
  __typename?: string;
  id?: string;
  permalink_url?: string;
  title?: { text?: string };
  all_users?: { edges?: Array<{ node?: { id?: string; name?: string } }> };
  items?: { edges?: unknown[] };
  comet_sections?: {
    content?: {
      story?: {
        actors?: Array<{ name?: string }>;
        message?: { text?: string };
        attachments?: Array<{
          title_with_entities?: { text?: string };
          media?: { __typename?: string };
        }>;
      };
    };
    timestamp?: { story?: { creation_time?: number } };
    context_layout?: {
      story?: {
        comet_sections?: {
          actor_photo?: { story?: { actors?: Array<{ name?: string }> } };
          metadata?: Array<{ story?: { creation_time?: number } }>;
        };
      };
    };
  };
}

interface RawNewsFeedResponse {
  data?: {
    viewer?: {
      news_feed?: {
        edges?: Array<{ node?: RawNewsFeedNode }>;
        page_info?: { has_next_page?: boolean; end_cursor?: string | null };
      };
    };
  };
}

function nodeToFeedItem(
  node: RawNewsFeedNode,
  index: number,
  sources: ('TOP_STORIES' | 'MOST_RECENT')[],
): FeedItemEntry {
  const base: FeedItemEntry = {
    index,
    kind: 'unknown',
    sources,
    storyID: null,
    actor: null,
    message: null,
    attachment: null,
    ts: null,
    permalink: null,
    pymkUsers: null,
    carouselTitle: null,
    carouselSize: null,
  };

  const story = node.comet_sections?.content?.story;
  const ctxStory = node.comet_sections?.context_layout?.story?.comet_sections;
  const actor =
    story?.actors?.[0]?.name ??
    ctxStory?.actor_photo?.story?.actors?.[0]?.name ??
    null;
  const message = story?.message?.text ?? null;
  const ts =
    node.comet_sections?.timestamp?.story?.creation_time ??
    ctxStory?.metadata?.[0]?.story?.creation_time ??
    null;

  if ((actor || message || ts) && node.id) {
    const attachment =
      story?.attachments?.[0]?.title_with_entities?.text ??
      story?.attachments?.[0]?.media?.__typename ??
      null;
    return {
      ...base,
      kind: 'story',
      storyID: node.id,
      actor,
      message,
      attachment,
      ts,
      permalink: node.permalink_url ?? null,
    };
  }

  const suggestedUsers =
    node.all_users?.edges
      ?.map((e) => ({ id: e.node?.id ?? '', name: e.node?.name ?? '' }))
      .filter((u) => u.id && u.name) ?? [];
  if (suggestedUsers.length > 0) {
    return { ...base, kind: 'pymk', pymkUsers: suggestedUsers };
  }

  const carouselEdges = node.items?.edges;
  if (carouselEdges) {
    return {
      ...base,
      kind: 'suggestion_carousel',
      carouselTitle: node.title?.text ?? null,
      carouselSize: carouselEdges.length,
    };
  }

  return base;
}

interface FetchedPage {
  nodes: RawNewsFeedNode[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

async function fetchFeedPage(
  orderby: 'TOP_STORIES' | 'MOST_RECENT',
  count: number,
  cursor: string | null,
): Promise<FetchedPage> {
  const userId = getViewerUserId();
  const raw = cursor
    ? await graphql<RawNewsFeedResponse>(
        userId,
        '26132524056448365',
        'CometNewsFeedPaginationQuery',
        {
          ...FEED_SHARED_VARIABLES,
          orderby: [orderby],
          count,
          cursor,
          clientQueryId: crypto.randomUUID(),
          clientSession: null,
          experimentalValues: null,
          focusCommentID: null,
          referringStoryRenderLocation: null,
        },
        { routeName: 'comet.fbweb.CometHomeRoot.react' },
      )
    : await graphql<RawNewsFeedResponse>(
        userId,
        '26450339851261998',
        'CometModernHomeFeedQuery',
        {
          ...FEED_SHARED_VARIABLES,
          orderby: [orderby],
          feedInitialFetchSize: count,
        },
        { routeName: 'comet.fbweb.CometHomeRoot.react' },
      );

  const feed = raw.data?.viewer?.news_feed;
  const nodes: RawNewsFeedNode[] = [];
  for (const edge of feed?.edges ?? []) {
    if (edge.node) nodes.push(edge.node);
  }
  return {
    nodes,
    pageInfo: {
      hasNextPage: feed?.page_info?.has_next_page ?? false,
      endCursor: feed?.page_info?.end_cursor ?? null,
    },
  };
}

const FEED_CACHE_KEY = '__vallum_facebook_feed_cache_v1';
const MAX_INTERNAL_FETCHES = 8;

interface CachedFeedSnapshot {
  cachedAt: number;
  items: FeedItemEntry[];
}

async function collectFeedNodes(
  orderby: 'TOP_STORIES' | 'MOST_RECENT',
  target: number,
): Promise<RawNewsFeedNode[]> {
  const nodes: RawNewsFeedNode[] = [];
  const seenIds = new Set<string>();
  let cursor: string | null = null;

  for (let i = 0; i < MAX_INTERNAL_FETCHES && nodes.length < target; i++) {
    const remaining = target - nodes.length;
    const page = await fetchFeedPage(orderby, remaining, cursor);

    for (const node of page.nodes) {
      if (node.id && seenIds.has(node.id)) continue;
      if (node.id) seenIds.add(node.id);
      nodes.push(node);
      if (nodes.length >= target) break;
    }

    if (!page.pageInfo.hasNextPage || page.nodes.length === 0) break;
    cursor = page.pageInfo.endCursor;
  }

  return nodes;
}

export async function listHomeFeed(
  params: ListHomeFeedInput,
): Promise<ListHomeFeedOutput> {
  const target = params.first;

  const [topNodes, recentNodes] = await Promise.all([
    collectFeedNodes('TOP_STORIES', target),
    collectFeedNodes('MOST_RECENT', target),
  ]);

  const recentIds = new Set<string>();
  for (const node of recentNodes) {
    if (node.id) recentIds.add(node.id);
  }

  const items: FeedItemEntry[] = [];
  const seenIds = new Set<string>();

  for (const node of topNodes) {
    if (node.id && seenIds.has(node.id)) continue;
    if (node.id) seenIds.add(node.id);
    const sources: ('TOP_STORIES' | 'MOST_RECENT')[] = ['TOP_STORIES'];
    if (node.id && recentIds.has(node.id)) sources.push('MOST_RECENT');
    items.push(nodeToFeedItem(node, items.length + 1, sources));
  }

  for (const node of recentNodes) {
    if (node.id && seenIds.has(node.id)) continue;
    if (node.id) seenIds.add(node.id);
    items.push(nodeToFeedItem(node, items.length + 1, ['MOST_RECENT']));
  }

  const cachedAt = Date.now();
  const snapshot: CachedFeedSnapshot = { cachedAt, items };
  localStorage.setItem(FEED_CACHE_KEY, JSON.stringify(snapshot));
  return { items, cachedAt };
}

export async function getCachedFeedItem(
  params: GetCachedFeedItemInput,
): Promise<GetCachedFeedItemOutput> {
  const raw = localStorage.getItem(FEED_CACHE_KEY);
  if (!raw) return { item: null, cachedAt: null };
  const snapshot = JSON.parse(raw) as CachedFeedSnapshot;
  const item = snapshot.items.find((i) => i.index === params.index) ?? null;
  return { item, cachedAt: snapshot.cachedAt };
}

export async function listStories(
  params: ListStoriesInput,
): Promise<FeedResponse> {
  const userId = getViewerUserId();
  return graphql<FeedResponse>(
    userId,
    '35492330733683955',
    'StoriesTrayRectangularRootQuery',
    {
      blur: 10,
      bucketsToFetch: params.bucketsToFetch,
      isFbNotesIncluded: true,
      scale: 1,
      __relay_internal__pv__StoriesTrayTileCoverImageWidthrelayprovider: 156,
      __relay_internal__pv__StoriesTrayTileCoverImageHeightrelayprovider: 277,
      __relay_internal__pv__StoriesShouldIncludeFbNotesrelayprovider: true,
    },
  );
}

export async function getRightSideCards(
  params: GetRightSideCardsInput,
): Promise<FeedResponse> {
  const userId = getViewerUserId();
  return graphql<FeedResponse>(
    userId,
    '26523523157297822',
    'CometRightSideHeaderCardsQuery',
    {
      refresh_num: params.refreshNum,
      scale: 1,
      __relay_internal__pv__GHLShouldChangeRHCSideFeedFieldNamerelayprovider: true,
      __relay_internal__pv__GHLShouldChangeRHCAdsFieldNamerelayprovider: true,
      __relay_internal__pv__GHLShouldChangeRHCFieldNamerelayprovider: false,
    },
  );
}

export async function getMegaphone(
  _params: GetMegaphoneInput,
): Promise<FeedResponse> {
  const userId = getViewerUserId();
  return graphql<FeedResponse>(
    userId,
    '26835975636038318',
    'CometMegaphoneRootQuery',
    {
      first: 1,
      scale: 1,
      __relay_internal__pv__FBReels_enable_view_dubbed_audio_type_gkrelayprovider: true,
    },
  );
}

export async function getPostPermalink(
  params: GetPostPermalinkInput,
): Promise<FeedResponse> {
  const userId = getViewerUserId();
  return graphql<FeedResponse>(
    userId,
    '26571181859198528',
    'CometSinglePostDialogContentQuery',
    {
      feedbackSource: 2,
      feedLocation: 'POST_PERMALINK_DIALOG',
      focusCommentID: params.focusCommentID ?? null,
      privacySelectorRenderLocation: 'COMET_STREAM',
      renderLocation: 'permalink',
      scale: 1,
      shouldChangeNodeFieldName: true,
      storyID: params.storyID,
      useDefaultActor: false,
      __relay_internal__pv__GHLShouldChangeAdIdFieldNamerelayprovider: true,
      __relay_internal__pv__GHLShouldChangeSponsoredDataFieldNamerelayprovider: true,
      __relay_internal__pv__CometFeedStory_enable_reactor_facepilerelayprovider: false,
      __relay_internal__pv__CometFeedStory_enable_post_permalink_white_space_clickrelayprovider: false,
      __relay_internal__pv__CometUFICommentActionLinksRewriteEnabledrelayprovider: false,
      __relay_internal__pv__CometUFICommentAvatarStickerAnimatedImagerelayprovider: false,
      __relay_internal__pv__IsWorkUserrelayprovider: false,
      __relay_internal__pv__TestPilotShouldIncludeDemoAdUseCaserelayprovider: false,
      __relay_internal__pv__FBReels_deprecate_short_form_video_context_gkrelayprovider: true,
      __relay_internal__pv__FBReels_enable_view_dubbed_audio_type_gkrelayprovider: true,
      __relay_internal__pv__CometImmersivePhotoCanUserDisable3DMotionrelayprovider: false,
      __relay_internal__pv__WorkCometIsEmployeeGKProviderrelayprovider: false,
      __relay_internal__pv__IsMergQAPollsrelayprovider: false,
      __relay_internal__pv__FBReelsMediaFooter_comet_enable_reels_ads_gkrelayprovider: true,
      __relay_internal__pv__CometUFIReactionsEnableShortNamerelayprovider: false,
      __relay_internal__pv__CometUFICommentAutoTranslationTyperelayprovider:
        'ORIGINAL',
      __relay_internal__pv__CometUFIShareActionMigrationrelayprovider: true,
      __relay_internal__pv__CometUFISingleLineUFIrelayprovider: true,
      __relay_internal__pv__CometUFI_dedicated_comment_routable_dialog_gkrelayprovider: true,
    },
  );
}
