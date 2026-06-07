/**
 * Facebook Library: Composer (top-level News Feed posts)
 *
 * Backed by the Comet inline-composer GraphQL surface:
 *   - createPost  → ComposerStoryCreateMutation
 *   - searchPlaces → useComposerLocationPickerTypeaheadDataSourceQuery
 */

import { getViewerUserId, graphql } from './helpers';
import type {
  CreatePostInput,
  CreatePostOutput,
  SearchPlacesInput,
  SearchPlacesOutput,
} from './schemas-compose';

const COMPOSER_ROUTE = 'comet.fbweb.CometHomeRoute';

interface RawCreatePostResponse {
  data?: {
    story_create?: {
      story?: {
        id?: string;
        legacy_story_hideable_id?: string;
        post_id?: string;
        url?: string;
        permalink_url?: string;
      };
    };
  };
}

export async function createPost(
  params: CreatePostInput,
): Promise<CreatePostOutput> {
  const userId = getViewerUserId();
  const sessionId = crypto.randomUUID();
  const idempotenceToken = `${crypto.randomUUID()}_FEED`;
  const attributionId = `CometHomeRoot.react,comet.home,logo,${Date.now()},0,,,`;

  const attachments = params.photoIds.map((id) => ({ photo: { id } }));

  const raw = await graphql<RawCreatePostResponse>(
    userId,
    '27616111224643858',
    'ComposerStoryCreateMutation',
    {
      input: {
        composer_entry_point: 'inline_composer',
        composer_source_surface: 'newsfeed',
        composer_type: 'feed',
        idempotence_token: idempotenceToken,
        source: 'WWW',
        audience: {
          privacy: {
            allow: [],
            base_state: params.privacy,
            deny: [],
            tag_expansion_state: 'UNSPECIFIED',
          },
        },
        message: { ranges: [], text: params.text },
        text_format_preset_id: '0',
        publishing_flow: {
          supported_flows: ['ASYNC_SILENT', 'ASYNC_NOTIF', 'FALLBACK'],
        },
        reels_remix: {
          is_original_audio_reusable: true,
          remix_status: 'ENABLED',
        },
        attachments,
        explicit_place_id: params.locationId ?? undefined,
        place_attachment_setting: params.locationId ? 'SHOWN' : undefined,
        logging: { composer_session_id: sessionId },
        navigation_data: { attribution_id_v2: attributionId },
        tracking: [null],
        event_share_metadata: { surface: 'newsfeed' },
        actor_id: userId,
        client_mutation_id: '1',
      },
      feedLocation: 'NEWSFEED',
      feedbackSource: 1,
      focusCommentID: null,
      gridMediaWidth: null,
      groupID: null,
      scale: 1,
      privacySelectorRenderLocation: 'COMET_STREAM',
      checkPhotosToReelsUpsellEligibility: true,
      referringStoryRenderLocation: null,
      renderLocation: 'homepage_stream',
      useDefaultActor: false,
      inviteShortLinkKey: null,
      isFeed: true,
      isFundraiser: false,
      isFunFactPost: false,
      isGroup: false,
      isEvent: false,
      isTimeline: false,
      isSocialLearning: false,
      isPageNewsFeed: false,
      isProfileReviews: false,
      isWorkSharedDraft: false,
      canUserManageOffers: false,
      __relay_internal__pv__CometUFIShareActionMigrationrelayprovider: true,
      __relay_internal__pv__GHLShouldChangeSponsoredDataFieldNamerelayprovider: true,
      __relay_internal__pv__GHLShouldChangeAdIdFieldNamerelayprovider: true,
      __relay_internal__pv__CometUFI_dedicated_comment_routable_dialog_gkrelayprovider: true,
      __relay_internal__pv__CometUFICommentAutoTranslationTyperelayprovider:
        'ORIGINAL',
      __relay_internal__pv__CometUFICommentAvatarStickerAnimatedImagerelayprovider: false,
      __relay_internal__pv__CometUFICommentActionLinksRewriteEnabledrelayprovider: false,
      __relay_internal__pv__IsWorkUserrelayprovider: false,
      __relay_internal__pv__CometUFIReactionsEnableShortNamerelayprovider: false,
      __relay_internal__pv__CometUFISingleLineUFIrelayprovider: true,
      __relay_internal__pv__CometFeedStory_enable_reactor_facepilerelayprovider: false,
      __relay_internal__pv__CometFeedStory_enable_post_permalink_white_space_clickrelayprovider: false,
      __relay_internal__pv__TestPilotShouldIncludeDemoAdUseCaserelayprovider: false,
      __relay_internal__pv__FBReels_deprecate_short_form_video_context_gkrelayprovider: true,
      __relay_internal__pv__FBReels_enable_view_dubbed_audio_type_gkrelayprovider: true,
      __relay_internal__pv__CometImmersivePhotoCanUserDisable3DMotionrelayprovider: false,
      __relay_internal__pv__WorkCometIsEmployeeGKProviderrelayprovider: false,
      __relay_internal__pv__IsMergQAPollsrelayprovider: false,
      __relay_internal__pv__FBReelsMediaFooter_comet_enable_reels_ads_gkrelayprovider: true,
      __relay_internal__pv__FBReelsIFUTileContent_reelsIFUPlayOnHoverrelayprovider: true,
      __relay_internal__pv__GroupsCometGYSJFeedItemHeightrelayprovider: 206,
      __relay_internal__pv__ShouldEnableBakedInTextStoriesrelayprovider: false,
      __relay_internal__pv__StoriesShouldIncludeFbNotesrelayprovider: true,
      __relay_internal__pv__GHLShouldChangeSponsoredAuctionDistanceFieldNamerelayprovider: false,
      __relay_internal__pv__GHLShouldUseSponsoredAuctionLabelFieldNameV1relayprovider: false,
      __relay_internal__pv__GHLShouldUseSponsoredAuctionLabelFieldNameV2relayprovider: false,
    },
    { routeName: COMPOSER_ROUTE },
  );

  const story = raw.data?.story_create?.story;
  return {
    storyId: story?.id ?? null,
    postId: story?.post_id ?? story?.legacy_story_hideable_id ?? null,
    url: story?.url ?? story?.permalink_url ?? null,
    raw: raw.data,
  };
}

interface RawPlacesResponse {
  data?: {
    places_typeahead_search?: {
      results?: Array<{
        place?: {
          id?: string;
          name?: string;
          address?: { single_line_full_address?: string; street?: string };
          location?: { latitude?: number; longitude?: number };
          category_names?: string[];
          city?: { name?: string };
          city_page?: { name?: string };
        };
      }>;
    };
  };
}

export async function searchPlaces(
  params: SearchPlacesInput,
): Promise<SearchPlacesOutput> {
  const userId = getViewerUserId();
  const raw = await graphql<RawPlacesResponse>(
    userId,
    '26544272061837065',
    'useComposerLocationPickerTypeaheadDataSourceQuery',
    {
      query_data: {
        caller_platform: 'FB_COMPOSER_CHECKIN',
        query: params.query,
      },
      num_nearby_places: params.limit,
      category_icon_size: 72,
    },
    { routeName: COMPOSER_ROUTE },
  );

  const list = raw.data?.places_typeahead_search?.results ?? [];
  const results = list.map((row) => {
    const p = row.place ?? {};
    return {
      id: p.id ?? '',
      name: p.name ?? null,
      address: p.address?.single_line_full_address ?? p.address?.street ?? null,
      category: p.category_names?.[0] ?? null,
      city: p.city?.name ?? p.city_page?.name ?? null,
      latitude: p.location?.latitude ?? null,
      longitude: p.location?.longitude ?? null,
    };
  });

  return { results, raw: raw.data };
}
