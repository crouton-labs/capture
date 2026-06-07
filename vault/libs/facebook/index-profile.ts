/**
 * Facebook Library: Profile Functions
 *
 * Profile reads against the Comet web GraphQL endpoint. Some functions
 * require opaque section/collection tokens minted by Facebook's SPA
 * router; these are resolved internally via `/ajax/route-definition/`.
 */

import {
  buildAppSectionFeedKey,
  buildRoutePath,
  getRouteDefinition,
  getViewerUserId,
  graphql,
  type RouteDefinitionProps,
} from './helpers';
import type {
  GetProfileHovercardInput,
  GetProfileHeaderInput,
  ProfileHeaderOutput,
  GetProfileTopSectionInput,
  GetProfileAboutInput,
  AboutOutput,
  GetProfileTimelineListViewInput,
  TimelineListViewOutput,
  ListProfilePostsInput,
  ListProfilePhotosInput,
  ListProfileSectionInput,
  SectionFeedOutput,
  GetProfileCollectionInput,
  CollectionOutput,
  ListProfileFriendsInput,
  ProfileResponse,
} from './schemas-profile';

// ============================================================================
// Shared Relay provider flag bundles (verbatim from captured HAR variables)
// ============================================================================

const FEED_RELAY_PROVIDERS = {
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
  __relay_internal__pv__FBReelsIFUTileContent_reelsIFUPlayOnHoverrelayprovider: true,
  __relay_internal__pv__GroupsCometGYSJFeedItemHeightrelayprovider: 206,
  __relay_internal__pv__ShouldEnableBakedInTextStoriesrelayprovider: false,
  __relay_internal__pv__StoriesShouldIncludeFbNotesrelayprovider: true,
};

const SECTION_RELAY_PROVIDERS = {
  __relay_internal__pv__FBProfile_enable_perf_improv_gkrelayprovider: true,
  __relay_internal__pv__CometUFIReactionsEnableShortNamerelayprovider: false,
  __relay_internal__pv__FBReels_deprecate_short_form_video_context_gkrelayprovider: true,
  __relay_internal__pv__FBReelsMediaFooter_comet_enable_reels_ads_gkrelayprovider: true,
  __relay_internal__pv__FBUnifiedVideoMediaContentContainer_comet_reels_video_footer_defer_loading_gkrelayprovider: false,
  __relay_internal__pv__FBUnifiedVideoMediaContentContainer_comet_video_document_picture_in_picture_gkrelayprovider: false,
  __relay_internal__pv__ShouldEnableBakedInTextUnifiedVideorelayprovider: false,
  __relay_internal__pv__FBUnifiedVideoMediaFooter_comet_enable_reels_ads_gkrelayprovider: true,
  __relay_internal__pv__FBUnifiedVideoMediaFooter_enable_meta_ai_pill_gkrelayprovider: true,
  __relay_internal__pv__FBUnifiedVideoMediaFooter_enable_ai_embodiment_chat_pill_gkrelayprovider: false,
  __relay_internal__pv__FBUnifiedVideoMediaFooter_enable_group_character_ai_info_pill_gkrelayprovider: true,
  __relay_internal__pv__FBUnifiedVideoMediaFooter_enable_video_augment_pills_gkrelayprovider: false,
  __relay_internal__pv__FBUnifiedVideoFeedbackBar_comet_reels_save_button_gkrelayprovider: false,
  __relay_internal__pv__usePushPipEngagementCounts_comet_video_document_picture_in_picture_gkrelayprovider: false,
  __relay_internal__pv__FBReels_enable_view_dubbed_audio_type_gkrelayprovider: true,
  __relay_internal__pv__FBUnifiedVideoMenu_fb_reels_ranking_debug_tool_gkrelayprovider: false,
};

// ============================================================================
// Internal helpers
// ============================================================================

interface RawProfileHeaderResponse {
  data?: {
    user?: {
      profile_header_renderer?: {
        user?: Record<string, unknown>;
      };
    };
  };
}

/**
 * Strip the origin from a profile URL, returning just the path (and query).
 * Handles both vanity URLs (https://www.facebook.com/MichaelHanchao) and
 * numeric profile.php URLs.
 */
function urlToRoutePath(profileUrl: string, fallback: string): string {
  try {
    const u = new URL(profileUrl);
    return u.pathname + u.search;
  } catch {
    return fallback;
  }
}

interface ParsedHeader {
  raw: RawProfileHeaderResponse;
  user: Record<string, unknown>;
  vanityRoutePath: string;
}

async function fetchProfileHeader(userID: string): Promise<ParsedHeader> {
  const viewerId = getViewerUserId();
  const raw = await graphql<RawProfileHeaderResponse>(
    viewerId,
    '26761890020094587',
    'ProfileCometHeaderQuery',
    {
      scale: 1,
      selectedID: userID,
      selectedSpaceType: 'profile',
      shouldUseFXIMProfilePicEditor: false,
      userID,
    },
  );
  const user = raw.data?.user?.profile_header_renderer?.user;
  if (!user) {
    throw new Error(
      `Facebook ProfileCometHeaderQuery returned no profile_header_renderer.user for userID=${userID}. The user may be private, blocked, or the ID may be invalid.`,
    );
  }
  const profileUrl = (user.url as string) ?? `/profile.php?id=${userID}`;
  const vanityRoutePath = urlToRoutePath(
    profileUrl,
    `/profile.php?id=${userID}`,
  );
  return { raw, user, vanityRoutePath };
}

async function resolveTokens(
  userID: string,
  slug: string,
): Promise<{ tokens: RouteDefinitionProps }> {
  const tokens = await getRouteDefinition(buildRoutePath(userID, slug));
  return { tokens };
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function asNullableString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}
function asBool(v: unknown): boolean {
  return v === true;
}

// ============================================================================
// getProfileHovercard (existing)
// ============================================================================

export async function getProfileHovercard(
  params: GetProfileHovercardInput,
): Promise<ProfileResponse> {
  const userId = getViewerUserId();
  return graphql<ProfileResponse>(
    userId,
    '27244011381867633',
    'CometHovercardQueryRendererQuery',
    {
      actionBarRenderLocation: 'WWW_COMET_HOVERCARD',
      context: 'DEFAULT',
      entityID: params.entityID,
      scale: 1,
      __relay_internal__pv__WorkCometIsEmployeeGKProviderrelayprovider: false,
    },
  );
}

// ============================================================================
// getProfileHeader
// ============================================================================

export async function getProfileHeader(
  params: GetProfileHeaderInput,
): Promise<ProfileHeaderOutput> {
  const { raw, user, vanityRoutePath } = await fetchProfileHeader(
    params.userID,
  );

  const profileUrl = asString(user.url);
  const userVanity = vanityRoutePath.startsWith('/profile.php')
    ? ''
    : vanityRoutePath.replace(/^\//, '').split('/')[0];

  const profileTabs = (
    user.profile_tabs as
      | { profile_user?: { timeline_nav_app_sections?: { edges?: unknown[] } } }
      | undefined
  )?.profile_user?.timeline_nav_app_sections?.edges;
  const sections = Array.isArray(profileTabs)
    ? profileTabs.map((e) => (e as { node?: unknown }).node)
    : [];

  return {
    userID: asString(user.id) || params.userID,
    name: asString(user.name),
    alternateName: asString(user.alternate_name),
    profileUrl,
    userVanity,
    gender: asNullableString(user.gender),
    isViewerFriend: asBool(user.is_viewer_friend),
    isVerified: asBool(user.show_verified_badge_on_profile),
    isMemorialized: asBool(user.is_visibly_memorialized),
    profilePicLargeUrl: asNullableString(
      (user.profilePicLarge as { uri?: unknown } | null)?.uri,
    ),
    profilePicMediumUrl: asNullableString(
      (user.profilePicMedium as { uri?: unknown } | null)?.uri,
    ),
    profilePicSmallUrl: asNullableString(
      (user.profilePicSmall as { uri?: unknown } | null)?.uri,
    ),
    coverPhoto: (user.cover_photo as Record<string, unknown> | null) ?? null,
    sections: sections as ProfileHeaderOutput['sections'],
    raw: raw.data,
  };
}

// ============================================================================
// getProfileTopSection
// ============================================================================

export async function getProfileTopSection(
  params: GetProfileTopSectionInput,
): Promise<{
  id: string;
  name: string;
  sectionType: string;
  url: string;
  raw: unknown;
}> {
  const viewerId = getViewerUserId();
  const { tokens } = await resolveTokens(params.userID, params.tabKey);
  if (!tokens.sectionToken) {
    throw new Error(
      `No sectionToken minted for userID=${params.userID} tabKey=${params.tabKey}. The tab may not exist on this profile.`,
    );
  }

  const raw = await graphql<{
    data?: { node?: Record<string, unknown> };
  }>(viewerId, '26661688470139180', 'ProfileCometTopAppSectionQuery', {
    collectionToken: tokens.collectionToken,
    scale: 1,
    sectionToken: tokens.sectionToken,
    useDefaultActor: false,
    userID: params.userID,
    ...SECTION_RELAY_PROVIDERS,
  });

  const node = raw.data?.node ?? {};
  return {
    id: asString(node.id) || tokens.sectionToken,
    name: asString(node.name),
    sectionType: asString(node.section_type),
    url: asString(node.url),
    raw: raw.data,
  };
}

// ============================================================================
// getProfileAbout
// ============================================================================

interface RawAboutEntity {
  __typename?: string;
  id?: string;
  name?: string;
  url?: string;
  profile_url?: string;
}

interface RawAboutRange {
  entity?: RawAboutEntity;
}

interface RawAboutField {
  field_type?: string;
  link_url?: string | null;
  title?: { text?: string; ranges?: RawAboutRange[] };
}

interface RawAboutFieldSection {
  field_section_type?: string;
  profile_fields?: { nodes?: RawAboutField[] };
}

interface RawAboutAppSection {
  activeCollections?: {
    nodes?: Array<{
      style_renderer?: {
        profile_field_sections?: RawAboutFieldSection[];
      };
    }>;
  };
}

interface RawAboutResponse {
  data?: {
    user?: {
      id?: string;
      about_app_sections?: { nodes?: RawAboutAppSection[] };
    };
  };
}

function extractEntities(
  ranges: RawAboutRange[] | undefined,
): AboutOutput['sections'][number]['fields'][number]['entities'] {
  if (!Array.isArray(ranges)) return [];
  const out: AboutOutput['sections'][number]['fields'][number]['entities'] = [];
  for (const r of ranges) {
    const e = r.entity;
    if (!e || typeof e.id !== 'string') continue;
    out.push({
      id: e.id,
      name: asString(e.name),
      url: asNullableString(e.url ?? e.profile_url),
      typename: asString(e.__typename),
    });
  }
  return out;
}

function flattenAboutSections(
  raw: RawAboutResponse['data'],
): AboutOutput['sections'] {
  const appSections = raw?.user?.about_app_sections?.nodes ?? [];
  const out: AboutOutput['sections'] = [];
  for (const s of appSections) {
    const cols = s.activeCollections?.nodes ?? [];
    for (const c of cols) {
      const pfs = c.style_renderer?.profile_field_sections ?? [];
      for (const sec of pfs) {
        const fields: AboutOutput['sections'][number]['fields'] = [];
        for (const node of sec.profile_fields?.nodes ?? []) {
          if (node.field_type === 'null_state') continue;
          if (!node.field_type) continue;
          fields.push({
            fieldType: node.field_type,
            text: asString(node.title?.text),
            entities: extractEntities(node.title?.ranges),
            url: asNullableString(node.link_url),
          });
        }
        if (fields.length > 0) {
          out.push({
            sectionType: asString(sec.field_section_type),
            fields,
          });
        }
      }
    }
  }
  return out;
}

function extractCityField(
  sections: AboutOutput['sections'],
  fieldType: 'current_city' | 'hometown',
): { name: string; pageId: string | null } | null {
  for (const s of sections) {
    for (const f of s.fields) {
      if (f.fieldType !== fieldType) continue;
      const page = f.entities.find((e) => e.typename === 'Page');
      // text is "Lives in {city}" / "From {city}"; strip the prefix using the page name
      const name = page?.name ?? f.text;
      return { name, pageId: page?.id ?? null };
    }
  }
  return null;
}

export async function getProfileAbout(
  params: GetProfileAboutInput,
): Promise<AboutOutput> {
  const viewerId = getViewerUserId();
  const { tokens } = await resolveTokens(params.userID, 'about');
  if (!tokens.rawSectionToken || !tokens.sectionToken) {
    throw new Error(
      `Facebook did not mint section tokens for /${params.userID}/about. Profile may be unreachable.`,
    );
  }

  const raw = await graphql<RawAboutResponse>(
    viewerId,
    '36193344930264869',
    'ProfileCometAboutAppSectionQuery',
    {
      appSectionFeedKey: buildAppSectionFeedKey(tokens.rawSectionToken),
      collectionToken: tokens.collectionToken,
      pageID: params.userID,
      rawSectionToken: tokens.rawSectionToken,
      scale: 1,
      sectionToken: tokens.sectionToken,
      showReactions: true,
      userID: params.userID,
      ...SECTION_RELAY_PROVIDERS,
    },
  );

  const sections = flattenAboutSections(raw.data);
  return {
    userID: asString(raw.data?.user?.id) || params.userID,
    currentCity: extractCityField(sections, 'current_city'),
    hometown: extractCityField(sections, 'hometown'),
    sections,
    raw: raw.data,
  };
}

// ============================================================================
// listProfilePosts
// ============================================================================

interface RawTimelineFeedResponse {
  data?: {
    user?: {
      timeline_list_feed_units?: {
        edges?: Array<{ node?: Record<string, unknown>; cursor?: string }>;
        page_info?: { has_next_page?: boolean; end_cursor?: string | null };
      };
    };
    node?: {
      timeline_list_feed_units?: {
        edges?: Array<{ node?: Record<string, unknown>; cursor?: string }>;
        page_info?: { has_next_page?: boolean; end_cursor?: string | null };
      };
    };
  };
}

export async function listProfilePosts(params: ListProfilePostsInput): Promise<{
  edges: Array<{ node: Record<string, unknown> }>;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  raw: unknown;
}> {
  const viewerId = getViewerUserId();
  const count = params.count ?? 3;

  const baseVars = {
    feedbackSource: 0,
    feedLocation: 'TIMELINE' as const,
    omitPinnedPost: true,
    privacySelectorRenderLocation: 'COMET_STREAM' as const,
    renderLocation: 'timeline',
    scale: 1,
    trackingCode: null,
    ...FEED_RELAY_PROVIDERS,
  };

  let raw: RawTimelineFeedResponse;
  if (params.cursor) {
    raw = await graphql<RawTimelineFeedResponse>(
      viewerId,
      '26547029044955620',
      'ProfileCometTimelineFeedRefetchQuery',
      {
        ...baseVars,
        afterTime: null,
        beforeTime: null,
        count,
        cursor: params.cursor,
        focusCommentID: null,
        memorializedSplitTimeFilter: null,
        postedBy: null,
        privacy: null,
        referringStoryRenderLocation: null,
        stream_count: 1,
        taggedInOnly: null,
        useDefaultActor: false,
        id: params.userID,
      },
    );
  } else {
    raw = await graphql<RawTimelineFeedResponse>(
      viewerId,
      '26654917800794305',
      'ProfileCometTimelineFeedQuery',
      { ...baseVars, count, userID: params.userID },
    );
  }

  const feed =
    raw.data?.user?.timeline_list_feed_units ??
    raw.data?.node?.timeline_list_feed_units;
  const edges =
    feed?.edges?.map((e) => ({
      node: (e.node ?? {}) as Record<string, unknown>,
    })) ?? [];

  return {
    edges,
    pageInfo: {
      hasNextPage: feed?.page_info?.has_next_page ?? false,
      endCursor: feed?.page_info?.end_cursor ?? null,
    },
    raw: raw.data,
  };
}

// ============================================================================
// getProfileTimelineListView
// ============================================================================

interface RawProfileTileNode {
  __typename?: string;
  profile_tile_section_type?: string;
  is_directory_protile?: boolean;
  is_pinned_profile_feature?: boolean;
  title?: { text?: string } | null;
  subtitle?: { text?: string } | string | null;
  url?: string | null;
  action_link?: {
    __typename?: string;
    title?: string;
    url?: string | null;
  } | null;
}

interface RawTimelineListViewResponse {
  data?: {
    user?: {
      id?: string;
      should_hide_visitor_content_on_timeline?: boolean;
      should_hide_privacy_filters?: boolean;
      if_viewer_has_professional_dashboard?: boolean;
      profile_composer_info?: unknown | null;
      highlight_units_section?: unknown | null;
      profile_info_review_unit?: unknown | null;
      delegate_page?: { id?: string } | null;
      profile_tile_sections?: {
        edges?: Array<{ node?: RawProfileTileNode; cursor?: string }>;
        page_info?: { has_next_page?: boolean; end_cursor?: string | null };
      };
    };
  };
}

function readTextish(
  v: { text?: string } | string | null | undefined,
): string | null {
  if (typeof v === 'string') return v;
  if (v && typeof v.text === 'string') return v.text;
  return null;
}

export async function getProfileTimelineListView(
  params: GetProfileTimelineListViewInput,
): Promise<TimelineListViewOutput> {
  const viewerId = getViewerUserId();
  const raw = await graphql<RawTimelineListViewResponse>(
    viewerId,
    '26477145488605232',
    'ProfileCometTimelineListViewRootQuery',
    {
      previousProfileId: null,
      privacySelectorRenderLocation: 'COMET_STREAM',
      renderLocation: 'timeline',
      scale: 1,
      userID: params.userID,
      __relay_internal__pv__GHLShouldChangeSponsoredDataFieldNamerelayprovider: true,
      __relay_internal__pv__WorkCometIsEmployeeGKProviderrelayprovider: false,
      __relay_internal__pv__GroupsCometGroupChatLazyLoadLastMessageSnippetrelayprovider: false,
      __relay_internal__pv__WebPixelRatiorelayprovider: 1,
    },
  );

  const user = raw.data?.user;
  const tilesRaw = user?.profile_tile_sections;
  const tiles: TimelineListViewOutput['tiles'] = [];
  for (const e of tilesRaw?.edges ?? []) {
    const n = e.node;
    if (!n || typeof n.profile_tile_section_type !== 'string') continue;
    const al = n.action_link;
    tiles.push({
      tileSectionType: n.profile_tile_section_type,
      title: readTextish(n.title),
      subtitle: readTextish(n.subtitle ?? null),
      url: asNullableString(n.url),
      isPinned: asBool(n.is_pinned_profile_feature),
      isDirectoryProtile: asBool(n.is_directory_protile),
      actionLink: al
        ? {
            title: asNullableString(al.title),
            url: asNullableString(al.url),
            typename: asString(al.__typename),
          }
        : null,
    });
  }

  return {
    userID: asString(user?.id) || params.userID,
    shouldHideVisitorContent: asBool(
      user?.should_hide_visitor_content_on_timeline,
    ),
    shouldHidePrivacyFilters: asBool(user?.should_hide_privacy_filters),
    hasProfessionalDashboard: asBool(
      user?.if_viewer_has_professional_dashboard,
    ),
    hasComposer: user?.profile_composer_info != null,
    hasHighlightUnits: user?.highlight_units_section != null,
    hasPendingReviewUnit: user?.profile_info_review_unit != null,
    delegatePageId: asNullableString(user?.delegate_page?.id),
    tiles,
    pageInfo: tilesRaw?.page_info
      ? {
          hasNextPage: tilesRaw.page_info.has_next_page ?? false,
          endCursor: tilesRaw.page_info.end_cursor ?? null,
        }
      : null,
    raw: raw.data,
  };
}

// ============================================================================
// listProfilePhotos
// ============================================================================

interface RawTilesResponse {
  data?: {
    node?: {
      profile_tile_views?: {
        nodes?: Array<{
          tiles_v2?: {
            tiles?: Array<Record<string, unknown>>;
            page_info?: {
              has_next_page?: boolean;
              end_cursor?: string | null;
            };
          };
        }>;
      };
    };
  };
}

export async function listProfilePhotos(
  params: ListProfilePhotosInput,
): Promise<{
  tiles: Array<Record<string, unknown>>;
  pageInfo?: { hasNextPage: boolean; endCursor: string | null };
  raw: unknown;
}> {
  const viewerId = getViewerUserId();
  const raw = await graphql<RawTilesResponse>(
    viewerId,
    '35329015153378795',
    'ProfileCometTilesFeedPaginationQuery',
    {
      count: params.count ?? 8,
      cursor: params.cursor ?? 'photos',
      previousProfileId: null,
      renderLocation: null,
      scale: 1,
      useDefaultActor: false,
      id: params.userID,
    },
  );

  const tilesContainer =
    raw.data?.node?.profile_tile_views?.nodes?.[0]?.tiles_v2;
  return {
    tiles: tilesContainer?.tiles ?? [],
    pageInfo: tilesContainer?.page_info
      ? {
          hasNextPage: tilesContainer.page_info.has_next_page ?? false,
          endCursor: tilesContainer.page_info.end_cursor ?? null,
        }
      : undefined,
    raw: raw.data,
  };
}

// ============================================================================
// listProfileSection
// ============================================================================

interface RawTimelineSectionNode {
  id?: string;
  name?: string;
  section_type?: string;
  subtitle?: string | null;
  url?: string;
  nav_collections?: { nodes?: Array<RawCollectionRef> };
  all_collections?: { nodes?: Array<RawCollectionRef> };
}

interface RawCollectionRef {
  id?: string;
  name?: string;
  tab_key?: string;
}

interface RawSectionFeedResponse {
  data?: {
    user?: {
      timeline_nav_app_sections?: {
        edges?: Array<{
          node?: RawTimelineSectionNode;
          cursor?: string;
        }>;
        page_info?: { has_next_page?: boolean; end_cursor?: string | null };
      };
    };
    node?: {
      timeline_nav_app_sections?: {
        edges?: Array<{
          node?: RawTimelineSectionNode;
          cursor?: string;
        }>;
        page_info?: { has_next_page?: boolean; end_cursor?: string | null };
      };
      timeline_app_collections?: {
        edges?: Array<{
          node?: RawTimelineSectionNode;
          cursor?: string;
        }>;
        page_info?: { has_next_page?: boolean; end_cursor?: string | null };
      };
    };
  };
}

function flattenCollectionRefs(
  raw: { nodes?: RawCollectionRef[] } | undefined,
): SectionFeedOutput['sections'][number]['navCollections'] {
  const out: SectionFeedOutput['sections'][number]['navCollections'] = [];
  for (const n of raw?.nodes ?? []) {
    if (typeof n.id !== 'string') continue;
    out.push({
      id: n.id,
      name: asNullableString(n.name),
      tabKey: asNullableString(n.tab_key),
    });
  }
  return out;
}

export async function listProfileSection(
  params: ListProfileSectionInput,
): Promise<SectionFeedOutput> {
  const viewerId = getViewerUserId();
  const count = params.count ?? 5;
  const { tokens } = await resolveTokens(params.userID, params.tabKey);
  if (!tokens.rawSectionToken) {
    throw new Error(
      `Facebook did not mint a rawSectionToken for /${params.userID}/${params.tabKey}.`,
    );
  }
  const appSectionFeedKey = buildAppSectionFeedKey(tokens.rawSectionToken);

  const raw = params.cursor
    ? await graphql<RawSectionFeedResponse>(
        viewerId,
        '26881659451438399',
        'ProfileCometAppSectionFeedPaginationQuery',
        {
          appSectionFeedKey,
          count,
          cursor: params.cursor,
          pageID: params.userID,
          renderLocation: null,
          scale: 1,
          showReactions: true,
          useDefaultActor: true,
          id: params.userID,
          ...SECTION_RELAY_PROVIDERS,
        },
      )
    : await graphql<RawSectionFeedResponse>(
        viewerId,
        '26616440461357951',
        'ProfileCometAppSectionFeedRootQuery',
        {
          appSectionFeedKey,
          cursor: tokens.rawSectionToken,
          pageID: params.userID,
          renderLocation: null,
          scale: 1,
          showReactions: true,
          useDefaultActor: true,
          userID: params.userID,
          ...SECTION_RELAY_PROVIDERS,
        },
      );

  const feed =
    raw.data?.user?.timeline_nav_app_sections ??
    raw.data?.node?.timeline_nav_app_sections ??
    raw.data?.node?.timeline_app_collections;
  const sections: SectionFeedOutput['sections'] = [];
  for (const e of feed?.edges ?? []) {
    const n = e.node;
    if (!n || typeof n.id !== 'string') continue;
    sections.push({
      id: n.id,
      name: asString(n.name),
      sectionType: asString(n.section_type),
      subtitle: asNullableString(n.subtitle),
      url: asString(n.url),
      navCollections: flattenCollectionRefs(n.nav_collections),
      allCollections: flattenCollectionRefs(n.all_collections),
      cursor: asNullableString(e.cursor),
    });
  }
  return {
    sections,
    pageInfo: feed?.page_info
      ? {
          hasNextPage: feed.page_info.has_next_page ?? false,
          endCursor: feed.page_info.end_cursor ?? null,
        }
      : null,
    raw: raw.data,
  };
}

// ============================================================================
// getProfileCollection
// ============================================================================

interface RawCollectionResponse {
  data?: {
    node?: {
      __typename?: string;
      id?: string;
      url?: string;
      items?: {
        nodes?: Array<Record<string, unknown>>;
        page_info?: { has_next_page?: boolean; end_cursor?: string | null };
      };
      style_renderer?: {
        __typename?: string;
        collection?: {
          name?: string;
          null_state_msg?: { text?: string } | string;
          items?: {
            nodes?: Array<Record<string, unknown>>;
            page_info?: { has_next_page?: boolean; end_cursor?: string | null };
          };
          pageItems?: {
            nodes?: Array<Record<string, unknown>>;
            page_info?: { has_next_page?: boolean; end_cursor?: string | null };
          };
        };
      };
    };
  };
}

export async function getProfileCollection(
  params: GetProfileCollectionInput,
): Promise<CollectionOutput> {
  const viewerId = getViewerUserId();
  if (
    typeof params.collectionKey !== 'string' ||
    !params.collectionKey.includes('_')
  ) {
    throw new Error(
      `getProfileCollection requires collectionKey as a slug like "about_overview" or "friends_all" (the tab_key field from getProfileHeader.sections[].all_collections.nodes[]). Received: ${JSON.stringify(params.collectionKey)}`,
    );
  }
  const { tokens } = await resolveTokens(params.userID, params.collectionKey);
  if (!tokens.collectionToken) {
    throw new Error(
      `Facebook did not mint a collectionToken for userID=${params.userID} collectionKey=${params.collectionKey}.`,
    );
  }

  const raw = await graphql<RawCollectionResponse>(
    viewerId,
    '27657048463885352',
    'ProfileCometSingleAppCollectionRootQuery',
    {
      collectionToken: tokens.collectionToken,
      scale: 1,
      useDefaultActor: false,
      showReactions: true,
      pageID: params.userID,
      renderLocation: null,
      ...SECTION_RELAY_PROVIDERS,
    },
  );

  const node = raw.data?.node;
  const sr = node?.style_renderer;
  const innerColl = sr?.collection;
  // Items can live on node.items, style_renderer.collection.items, or
  // style_renderer.collection.pageItems depending on the renderer.
  const itemsContainer =
    innerColl?.items ?? innerColl?.pageItems ?? node?.items;
  const items = itemsContainer?.nodes ?? [];
  const pi = itemsContainer?.page_info;
  const nullState = innerColl?.null_state_msg;
  const nullStateText =
    typeof nullState === 'string'
      ? nullState
      : typeof nullState?.text === 'string'
        ? nullState.text
        : null;

  return {
    id: asString(node?.id) || tokens.collectionToken,
    name: asNullableString(innerColl?.name),
    url: asNullableString(node?.url),
    rendererType: asString(sr?.__typename),
    nullStateMessage: nullStateText,
    items,
    pageInfo: pi
      ? {
          hasNextPage: pi.has_next_page ?? false,
          endCursor: pi.end_cursor ?? null,
        }
      : null,
    raw: raw.data,
  };
}

// ============================================================================
// listProfileFriends
// ============================================================================

interface RawFriendsListResponse {
  data?: {
    node?: {
      profile_friend_collection?: {
        style_renderer?: {
          friends?: {
            edges?: Array<{ node?: Record<string, unknown>; cursor?: string }>;
            page_info?: {
              has_next_page?: boolean;
              end_cursor?: string | null;
            };
          };
        };
      };
      pageItems?: {
        edges?: Array<{ node?: Record<string, unknown>; cursor?: string }>;
        page_info?: { has_next_page?: boolean; end_cursor?: string | null };
      };
    };
  };
}

export async function listProfileFriends(params: ListProfileFriendsInput) {
  const viewerId = getViewerUserId();
  const count = params.count ?? 8;
  const { tokens } = await resolveTokens(params.userID, 'friends_all');
  if (!tokens.collectionToken) {
    throw new Error(
      `Facebook did not mint a collectionToken for userID=${params.userID} slug=friends_all.`,
    );
  }

  const raw = await graphql<RawFriendsListResponse>(
    viewerId,
    '26565284836436780',
    'ProfileCometAppCollectionNonSelfFriendsListRendererPaginationQuery',
    {
      count,
      cursor: params.cursor ?? null,
      scale: 1,
      search: params.search ?? null,
      id: tokens.collectionToken,
      __relay_internal__pv__FBProfile_enable_perf_improv_gkrelayprovider: true,
    },
  );

  const friendsBlock =
    raw.data?.node?.profile_friend_collection?.style_renderer?.friends ??
    raw.data?.node?.pageItems;
  const friends =
    friendsBlock?.edges?.map((edge) => {
      const n = (edge.node ?? {}) as Record<string, unknown>;
      const profilePicture = n.profile_picture as { uri?: unknown } | undefined;
      return {
        id: asString(n.id),
        name: asNullableString(n.name),
        profilePicUrl: asNullableString(profilePicture?.uri),
        url: asNullableString(n.url),
        mutualFriendsText: asNullableString(
          (n.profile_social_context as { text?: unknown } | undefined)?.text,
        ),
      };
    }) ?? [];

  return {
    friends,
    pageInfo: friendsBlock?.page_info
      ? {
          hasNextPage: friendsBlock.page_info.has_next_page ?? false,
          endCursor: friendsBlock.page_info.end_cursor ?? null,
        }
      : undefined,
    raw: raw.data,
  };
}
