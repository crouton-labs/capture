import { getViewerUserId, graphql } from './helpers';
import type {
  ListVideoFeedInput,
  GetVideoEntrypointInput,
  GetWatchBadgeCountInput,
  VideoResponse,
} from './schemas-video';

const VIDEO_FEED_CONTEXT = {
  arltw_feed_sections: [],
  is_external_deeplink: false,
  source: 'DEEPLINK',
  surface: 'REELS_TAB',
};

export async function listVideoFeed(
  params: ListVideoFeedInput,
): Promise<VideoResponse> {
  const userId = getViewerUserId();
  return graphql<VideoResponse>(
    userId,
    '26535214419467101',
    'FBUnifiedVideoContainerQuery',
    {
      count: params.count,
      cursor: params.cursor ?? null,
      scale: 1,
      should_use_stream: true,
      stream_initial_count: 1,
      useDefaultActor: false,
      video_feed_context_data: VIDEO_FEED_CONTEXT,
    },
    { routeName: 'comet.fbweb.CometUnifiedVideoRoute' },
  );
}

export async function getVideoEntrypoint(
  _params: GetVideoEntrypointInput,
): Promise<VideoResponse> {
  const userId = getViewerUserId();
  return graphql<VideoResponse>(
    userId,
    '26878541478445903',
    'FBUnifiedVideoRootWithEntrypointQuery',
    {
      count: 1,
      initial_node_id: '',
      isAggregationProfileViewerOrShouldShowReelsForPage: false,
      page_id: '',
      scale: 1,
      should_use_stream: true,
      shouldIncludeInitialNodeFetch: false,
      shouldShowReelsForPage: false,
      stream_initial_count: 1,
      useDefaultActor: false,
      video_feed_context_data: VIDEO_FEED_CONTEXT,
    },
  );
}

export async function getWatchBadgeCount(
  _params: GetWatchBadgeCountInput,
): Promise<VideoResponse> {
  const userId = getViewerUserId();
  return graphql<VideoResponse>(
    userId,
    '23979318198368825',
    'useCometWatchBadgeCountQuery',
    {},
  );
}
