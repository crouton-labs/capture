import { getViewerUserId, graphql } from './helpers';
import type {
  GetBootstrapKeywordsInput,
  SearchResponse,
  SearchAllInput,
  SearchAllOutput,
  SearchPeopleInput,
  SearchPeopleOutput,
  GetKeywordSuggestionsInput,
  GetKeywordSuggestionsOutput,
  RecordTypeaheadSelectionInput,
  RecordTypeaheadSelectionOutput,
} from './schemas-search';

// ============================================================================
// Shared search Relay providers
// ============================================================================

const SEARCH_RELAY_PROVIDERS = {
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

function asNullableString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function buildSearchSessionContext(): { bsid: string; tsid: string } {
  const bsid =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const tsid = `0.${Math.random().toString().slice(2)}`;
  return { bsid, tsid };
}

// ============================================================================
// getBootstrapKeywords (existing)
// ============================================================================

export async function getBootstrapKeywords(
  params: GetBootstrapKeywordsInput,
): Promise<SearchResponse> {
  const userId = getViewerUserId();
  return graphql<SearchResponse>(
    userId,
    '25955120204098652',
    'CometSearchBootstrapKeywordsDataSourceQuery',
    { first: params.first },
  );
}

// ============================================================================
// searchAll
// ============================================================================

interface ProfileViewModel {
  profile?: Record<string, unknown>;
  profile_caption?: { text?: unknown };
  see_more_model?: {
    query?: { encrypted_server_defined_experience?: string };
  };
}

interface InnerRenderingStrategy {
  view_model?: ProfileViewModel;
}

interface SearchResultEdge {
  node?: { role?: string; __typename?: string };
  rendering_strategy?: {
    view_model?: ProfileViewModel & { __typename?: string };
    result_rendering_strategies?: InnerRenderingStrategy[];
  };
}

interface RawSearchResultsResponse {
  data?: {
    serpResponse?: {
      results?: {
        edges?: SearchResultEdge[];
        page_info?: { has_next_page?: boolean; end_cursor?: string | null };
      };
    };
  };
}

function extractFromViewModel(
  vm: ProfileViewModel,
): SearchAllOutput['results'][number] | null {
  const profile = vm.profile;
  if (!profile || typeof profile.id !== 'string') return null;
  const profilePicture = profile.profile_picture as
    | { uri?: unknown }
    | undefined;
  return {
    entityId: asNullableString(profile.id),
    entityType: asNullableString(profile.__typename),
    name: asNullableString(profile.name),
    url: asNullableString(profile.url ?? profile.profile_url),
    profilePicUrl: asNullableString(profilePicture?.uri),
    subtitle: asNullableString(vm.profile_caption?.text),
  };
}

function extractEntityResults(
  edge: SearchResultEdge,
): SearchAllOutput['results'] {
  // Variant A — People-tab / SERVER_DEFINED query: profile lives directly on
  // the outer view_model (one entity per edge).
  const outerVm = edge.rendering_strategy?.view_model;
  const outerHit = outerVm ? extractFromViewModel(outerVm) : null;
  if (outerHit) return [outerHit];

  // Variant B — GLOBAL_SEARCH SERP overview: each edge is a category module
  // with up to ~5 profiles nested inside result_rendering_strategies.
  const inner = edge.rendering_strategy?.result_rendering_strategies ?? [];
  const out: SearchAllOutput['results'] = [];
  for (const strategy of inner) {
    if (!strategy.view_model) continue;
    const hit = extractFromViewModel(strategy.view_model);
    if (hit) out.push(hit);
  }
  return out;
}

export async function searchAll(
  params: SearchAllInput,
): Promise<SearchAllOutput> {
  const userId = getViewerUserId();
  const count = params.count ?? 5;
  const ctx = buildSearchSessionContext();
  const args = {
    callsite: 'COMET_GLOBAL_SEARCH',
    config: {
      exact_match: false,
      high_confidence_config: null,
      intercept_config: null,
      sts_disambiguation: null,
      watch_config: null,
    },
    context: ctx,
    experience: {
      client_defined_experiences: ['ADS_PARALLEL_FETCH'],
      encoded_server_defined_params: null,
      fbid: null,
      type: 'GLOBAL_SEARCH',
    },
    filters: [],
    text: params.query,
  };

  const raw = params.cursor
    ? await graphql<RawSearchResultsResponse>(
        userId,
        '26551837051121943',
        'SearchCometResultsPaginatedResultsQuery',
        {
          allow_streaming: false,
          args,
          count,
          cursor: params.cursor,
          feedLocation: 'SEARCH',
          feedbackSource: 23,
          fetch_filters: true,
          focusCommentID: null,
          locale: null,
          privacySelectorRenderLocation: 'COMET_STREAM',
          referringStoryRenderLocation: null,
          renderLocation: 'search_results_page',
          scale: 1,
          stream_initial_count: 0,
          useDefaultActor: false,
          ...SEARCH_RELAY_PROVIDERS,
        },
      )
    : await graphql<RawSearchResultsResponse>(
        userId,
        '26986616030973017',
        'SearchCometResultsInitialResultsQuery',
        {
          count,
          allow_streaming: false,
          args,
          cursor: null,
          feedbackSource: 23,
          fetch_filters: true,
          renderLocation: 'search_results_page',
          scale: 1,
          stream_initial_count: 0,
          useDefaultActor: false,
          ...SEARCH_RELAY_PROVIDERS,
        },
      );

  const edges = raw.data?.serpResponse?.results?.edges ?? [];
  const results = edges.flatMap(extractEntityResults);
  const pageInfo = raw.data?.serpResponse?.results?.page_info;

  return {
    results,
    cursor: pageInfo?.has_next_page ? (pageInfo.end_cursor ?? null) : null,
    raw: raw.data,
  };
}

// ============================================================================
// searchPeople
// ============================================================================

/**
 * Walk a SERP-overview raw response and return the People module's encrypted
 * server-defined experience blob — the parameter that turns the same SERP
 * query into a People-only paginated query.
 */
function findPeopleExperience(raw: unknown): string | null {
  const edges =
    (raw as RawSearchResultsResponse['data'])?.serpResponse?.results?.edges ??
    [];
  for (const edge of edges) {
    if (edge.node?.role !== 'ENTITY_USER') continue;
    const exp =
      edge.rendering_strategy?.view_model?.see_more_model?.query
        ?.encrypted_server_defined_experience;
    if (typeof exp === 'string' && exp.length > 0) return exp;
  }
  return null;
}

interface WrappedCursor {
  e: string;
  c: string;
}

function encodeWrappedCursor(experience: string, fbCursor: string): string {
  return btoa(JSON.stringify({ e: experience, c: fbCursor } as WrappedCursor));
}

function decodeWrappedCursor(wrapped: string): WrappedCursor {
  const parsed = JSON.parse(atob(wrapped)) as Partial<WrappedCursor>;
  if (typeof parsed.e !== 'string' || typeof parsed.c !== 'string') {
    throw new Error(
      'searchPeople: cursor is malformed. Pass back the cursor returned by a previous searchPeople call.',
    );
  }
  return { e: parsed.e, c: parsed.c };
}

export async function searchPeople(
  params: SearchPeopleInput,
): Promise<SearchPeopleOutput> {
  const userId = getViewerUserId();
  const count = params.count ?? 5;
  const ctx = buildSearchSessionContext();

  let experience: string;
  let fbCursor: string | null = null;

  if (params.cursor) {
    const wrapped = decodeWrappedCursor(params.cursor);
    experience = wrapped.e;
    fbCursor = wrapped.c;
  } else {
    const overview = await searchAll({ query: params.query, count: 1 });
    const found = findPeopleExperience(overview.raw);
    if (!found) {
      throw new Error(
        `searchPeople: no People module in SERP overview for "${params.query}". Query may have zero people matches.`,
      );
    }
    experience = found;
  }

  const args = {
    callsite: 'COMET_GLOBAL_SEARCH',
    config: {
      exact_match: false,
      high_confidence_config: null,
      intercept_config: null,
      sts_disambiguation: null,
      watch_config: null,
    },
    context: ctx,
    experience: {
      client_defined_experiences: ['ADS_PARALLEL_FETCH'],
      encoded_server_defined_params: experience,
      fbid: null,
      type: 'SERVER_DEFINED',
    },
    filters: [],
    text: params.query,
  };

  const raw = fbCursor
    ? await graphql<RawSearchResultsResponse>(
        userId,
        '26551837051121943',
        'SearchCometResultsPaginatedResultsQuery',
        {
          allow_streaming: false,
          args,
          count,
          cursor: fbCursor,
          feedLocation: 'SEARCH',
          feedbackSource: 23,
          fetch_filters: true,
          focusCommentID: null,
          locale: null,
          privacySelectorRenderLocation: 'COMET_STREAM',
          referringStoryRenderLocation: null,
          renderLocation: 'search_results_page',
          scale: 1,
          stream_initial_count: 0,
          useDefaultActor: false,
          ...SEARCH_RELAY_PROVIDERS,
        },
      )
    : await graphql<RawSearchResultsResponse>(
        userId,
        '26986616030973017',
        'SearchCometResultsInitialResultsQuery',
        {
          count,
          allow_streaming: false,
          args,
          cursor: null,
          feedbackSource: 23,
          fetch_filters: true,
          renderLocation: 'search_results_page',
          scale: 1,
          stream_initial_count: 0,
          useDefaultActor: false,
          ...SEARCH_RELAY_PROVIDERS,
        },
      );

  const edges = raw.data?.serpResponse?.results?.edges ?? [];
  const results = edges.flatMap(extractEntityResults);
  const pageInfo = raw.data?.serpResponse?.results?.page_info;
  const nextCursor =
    pageInfo?.has_next_page && pageInfo.end_cursor
      ? encodeWrappedCursor(experience, pageInfo.end_cursor)
      : null;

  return {
    results,
    cursor: nextCursor,
    raw: raw.data,
  };
}

// ============================================================================
// getKeywordSuggestions
// ============================================================================

interface RawKeywordSuggestionsResponse {
  data?: {
    search_keywords_suggestion?: {
      suggestions?: {
        edges?: Array<{
          node?: { text?: unknown; type?: unknown };
        }>;
      };
    };
  };
}

export async function getKeywordSuggestions(
  params: GetKeywordSuggestionsInput,
): Promise<GetKeywordSuggestionsOutput> {
  const userId = getViewerUserId();
  // Facebook's web client encodes query as a JSON-stringified array of
  // characters; we replicate that exactly.
  const queryText = JSON.stringify(Array.from(params.query));

  const raw = await graphql<RawKeywordSuggestionsResponse>(
    userId,
    '34279758474973265',
    'CometSearchKeywordDataSourceQuery',
    {
      query: {
        fetch_count: params.fetchCount ?? 8,
        fetch_mode: 'scoped',
        query_text: queryText,
        request_id: String(Date.now()),
        session_id: `0.${Math.random().toString().slice(2)}`,
      },
    },
  );

  const edges = raw.data?.search_keywords_suggestion?.suggestions?.edges ?? [];
  return {
    suggestions: edges.map((e) => ({
      text: asNullableString(e.node?.text),
      type: asNullableString(e.node?.type),
    })),
    raw: raw.data,
  };
}

// ============================================================================
// recordTypeaheadSelection
// ============================================================================

interface RawTypeaheadAddResponse {
  data?: {
    search_typeahead_add_recent_search?: {
      client_mutation_id?: string | null;
    };
  };
}

export async function recordTypeaheadSelection(
  params: RecordTypeaheadSelectionInput,
): Promise<RecordTypeaheadSelectionOutput> {
  const userId = getViewerUserId();
  const raw = await graphql<RawTypeaheadAddResponse>(
    userId,
    '9990530167705749',
    'CometAddTypeaheadRecentSearchMutation',
    {
      input: {
        actor_id: userId,
        client_mutation_id: String(Date.now() % 1000),
        selected_text: params.selectedText,
        selected_type: params.selectedType ?? 'keyword',
        source: 'SEARCH_GLOBAL',
        user_input: params.query,
      },
    },
  );

  return {
    clientMutationId: asNullableString(
      raw.data?.search_typeahead_add_recent_search?.client_mutation_id,
    ),
    raw: raw.data,
  };
}
