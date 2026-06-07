/**
 * Instagram Library: Misc Functions
 *
 * getInboxTray, getSearchSuggestions, getViewerSettings, unsendMessage
 */

import { ContractDrift, Unauthenticated, UpstreamError, throwForStatus } from '@vallum/_runtime';
import {
  buildHeaders,
  getAppId,
  getCookie,
  getRequire,
  graphqlPrimary,
  graphqlQuery,
} from './helpers';
import type {
  GetInboxTrayInput,
  GetInboxTrayOutput,
  GetSearchSuggestionsInput,
  GetSearchSuggestionsOutput,
  GetViewerSettingsInput,
  GetViewerSettingsOutput,
  UnsendMessageInput,
  UnsendMessageOutput,
} from './schemas';

// ============================================================================
// getInboxTray
// ============================================================================

interface IGInboxTrayThread {
  thread_id?: string;
  thread_key?: string;
  thread_title?: string;
  is_group?: boolean;
  marked_as_unread?: boolean;
  last_activity_timestamp_ms?: string;
  folder?: string;
  is_muted?: boolean;
  is_pin?: boolean;
  thread_subtype?: string;
  users?: Array<{
    id?: string;
    username?: string;
    profile_pic_url?: string;
  }>;
  slide_messages?: {
    edges?: Array<{
      node?: {
        igd_snippet?: string;
      };
    }>;
  };
}

interface IGInboxTrayThreadConnection {
  edges?: Array<{
    node?: {
      as_ig_direct_thread?: IGInboxTrayThread;
    };
  }>;
  page_info?: {
    has_next_page?: boolean;
    end_cursor?: string;
  };
}

interface IGInboxTrayResponse {
  data?: {
    get_slide_mailbox_for_iris_subscription?: {
      threads_by_folder?: IGInboxTrayThreadConnection;
    };
  };
}

interface IGInboxTrayPaginationResponse {
  data?: {
    node?: {
      threads_by_folder?: IGInboxTrayThreadConnection;
    };
  };
}

function parseThreadEdges(connection: IGInboxTrayThreadConnection | undefined) {
  const edges = connection?.edges || [];
  const pageInfo = connection?.page_info;

  const threads = edges
    .map((edge) => {
      const thread = edge.node?.as_ig_direct_thread;
      if (!thread) return null;

      const participants = (thread.users || []).map((user) => ({
        userId: user.id || '',
        username: user.username || '',
        profilePicUrl: user.profile_pic_url || '',
      }));

      // Extract snippet from the first message
      const firstMsg = thread.slide_messages?.edges?.[0]?.node;
      const lastMessageSnippet = firstMsg?.igd_snippet || '';

      return {
        threadId: thread.thread_id || '',
        threadKey: thread.thread_key || '',
        threadTitle:
          thread.thread_title || participants.map((p) => p.username).join(', '),
        isGroup: Boolean(thread.is_group),
        isUnread: Boolean(thread.marked_as_unread),
        lastActivityTimestamp: Number(thread.last_activity_timestamp_ms || 0),
        participants,
        lastMessageSnippet,
        folder: thread.folder || '',
        isMuted: Boolean(thread.is_muted),
        isPinned: Boolean(thread.is_pin),
        threadSubtype: thread.thread_subtype || '',
      };
    })
    .filter((t): t is NonNullable<typeof t> => t !== null);

  return {
    threads,
    totalCount: threads.length,
    hasMore: Boolean(pageInfo?.has_next_page),
    nextCursor: pageInfo?.has_next_page ? pageInfo.end_cursor || null : null,
  };
}

export async function getInboxTray(
  params: GetInboxTrayInput,
): Promise<GetInboxTrayOutput> {
  const csrf = params.csrf || getCookie('csrftoken') || '';
  if (!csrf) {
    throw new Unauthenticated(
      'getInboxTray: CSRF token not found. Pass csrf param or ensure csrftoken cookie exists.',
    );
  }
  const deviceId =
    localStorage.getItem('chatd-deviceid') || crypto.randomUUID();

  // Use pagination query when cursor is provided
  if (params.cursor) {
    const data = await graphqlPrimary<IGInboxTrayPaginationResponse>(
      csrf,
      '26537595065841187',
      'IGDThreadListOffMsysPaginationQuery',
      {
        cursor: params.cursor,
        count: params.count ?? 15,
        folder: params.folder ?? 'INBOX',
        newer_than_timestamp_ms: params.newerThanTimestampMs ?? null,
        id: null,
        __relay_internal__pv__IGDPinnedThreadsRenderEnabledGKrelayprovider: true,
        __relay_internal__pv__IGDMaxUnreadMessagesCountrelayprovider: 5,
        __relay_internal__pv__IGDThreadListActionsEnabledGKrelayprovider: false,
      },
    );

    const node = data?.data?.node;
    if (!node) {
      throw new ContractDrift(
        `getInboxTray: Failed to parse pagination response. Keys: ${JSON.stringify(Object.keys(data?.data || {}))}`,
      );
    }

    return parseThreadEdges(node.threads_by_folder);
  }

  // First page: use the initial inbox query
  const data = await graphqlPrimary<IGInboxTrayResponse>(
    csrf,
    '25119090594436966',
    'PolarisDirectInboxQuery',
    {
      device_id_for_iris_subscription: deviceId,
      __relay_internal__pv__IGDEnableOffMsysThreadListQErelayprovider: true,
      __relay_internal__pv__IGDIsProfessionalAccountGKrelayprovider: false,
      __relay_internal__pv__IGDPinnedThreadsRenderEnabledGKrelayprovider: true,
      __relay_internal__pv__IGDMaxUnreadMessagesCountrelayprovider: 5,
      __relay_internal__pv__IGDThreadListActionsEnabledGKrelayprovider: false,
    },
  );

  const mailbox = data?.data?.get_slide_mailbox_for_iris_subscription;
  if (!mailbox) {
    throw new ContractDrift(
      `getInboxTray: Failed to parse inbox response. Keys: ${JSON.stringify(Object.keys(data?.data || {}))}`,
    );
  }

  return parseThreadEdges(mailbox.threads_by_folder);
}

// ============================================================================
// getSearchSuggestions
// ============================================================================

interface IGSearchUserFields {
  pk?: string | number;
  id?: string;
  username?: string;
  full_name?: string;
  profile_pic_url?: string;
  hd_profile_pic_url_info?: { url?: string } | null;
  is_verified?: boolean;
  search_social_context?: string | null;
  search_social_context_snippet_type?: string | null;
  unseen_count?: number;
  live_broadcast_visibility?: string | null;
  live_broadcast_id?: string | null;
  ai_agent_owner_username?: string | null;
  is_unpublished?: boolean | null;
}

interface IGSearchHashtagFields {
  id?: string;
  name?: string;
  media_count?: number;
  search_result_subtitle?: string | null;
}

interface IGSearchPlaceFields {
  location?: {
    pk?: string | number;
    name?: string;
    facebook_places_id?: string | number;
  };
  subtitle?: string | null;
  title?: string | null;
}

interface IGSearchKeywordFields {
  name?: string;
  id?: string;
}

interface IGSearchQueryResponse {
  data?: {
    xdt_api__v1__fbsearch__topsearch_connection?: {
      users?: Array<{ position?: number; user?: IGSearchUserFields }>;
      hashtags?: Array<{ position?: number; hashtag?: IGSearchHashtagFields }>;
      places?: Array<{ position?: number; place?: IGSearchPlaceFields }>;
      see_more?: {
        preview_number?: number;
        list?: Array<{ position?: number; keyword?: IGSearchKeywordFields }>;
      } | null;
    };
  };
}

type SuggestionItem = GetSearchSuggestionsOutput['suggestions'][number];

function mapUser(user: IGSearchUserFields): SuggestionItem {
  return {
    type: 'user',
    userId: String(user.pk || user.id || ''),
    username: user.username || null,
    fullName: user.full_name || null,
    profilePicUrl: user.profile_pic_url || null,
    hdProfilePicUrl: user.hd_profile_pic_url_info?.url || null,
    isVerified: Boolean(user.is_verified),
    socialContext: user.search_social_context || null,
    isLiveBroadcasting: user.live_broadcast_id != null,
    hashtag: null,
    hashtagMediaCount: null,
    hashtagSubtitle: null,
    placeName: null,
    placeSubtitle: null,
    keyword: null,
    searchQuery: user.username || '',
  };
}

function mapHashtag(hashtag: IGSearchHashtagFields): SuggestionItem {
  return {
    type: 'hashtag',
    userId: null,
    username: null,
    fullName: null,
    profilePicUrl: null,
    hdProfilePicUrl: null,
    isVerified: false,
    socialContext: null,
    isLiveBroadcasting: false,
    hashtag: hashtag.name || null,
    hashtagMediaCount: hashtag.media_count ?? null,
    hashtagSubtitle: hashtag.search_result_subtitle || null,
    placeName: null,
    placeSubtitle: null,
    keyword: null,
    searchQuery: hashtag.name || '',
  };
}

function mapPlace(place: IGSearchPlaceFields): SuggestionItem {
  const name = place.title || place.location?.name || '';
  return {
    type: 'place',
    userId: null,
    username: null,
    fullName: null,
    profilePicUrl: null,
    hdProfilePicUrl: null,
    isVerified: false,
    socialContext: null,
    isLiveBroadcasting: false,
    hashtag: null,
    hashtagMediaCount: null,
    hashtagSubtitle: null,
    placeName: name,
    placeSubtitle: place.subtitle || null,
    keyword: null,
    searchQuery: name,
  };
}

function mapKeyword(kw: IGSearchKeywordFields): SuggestionItem {
  return {
    type: 'keyword',
    userId: null,
    username: null,
    fullName: null,
    profilePicUrl: null,
    hdProfilePicUrl: null,
    isVerified: false,
    socialContext: null,
    isLiveBroadcasting: false,
    hashtag: null,
    hashtagMediaCount: null,
    hashtagSubtitle: null,
    placeName: null,
    placeSubtitle: null,
    keyword: kw.name || null,
    searchQuery: kw.name || '',
  };
}

export async function getSearchSuggestions(
  params: GetSearchSuggestionsInput,
): Promise<GetSearchSuggestionsOutput> {
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  const hexHash = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const rankToken = String(Date.now()) + '|' + hexHash;
  const searchSessionId = crypto.randomUUID();

  const variables: Record<string, unknown> = {
    data: {
      context: params.context || 'blended',
      include_reel: String(params.includeReel !== false),
      query: params.query,
      rank_token: rankToken,
      search_session_id: searchSessionId,
      search_surface: params.searchSurface || 'web_top_search',
    },
    hasQuery: true,
  };

  const data = await graphqlQuery<IGSearchQueryResponse>(
    params.csrf,
    '24146980661639222',
    'PolarisSearchBoxRefetchableQuery',
    variables,
  );

  const searchData = data?.data?.xdt_api__v1__fbsearch__topsearch_connection;
  if (!searchData) {
    throw new ContractDrift(
      `getSearchSuggestions: Failed to parse search results. Keys: ${JSON.stringify(Object.keys(data?.data || {}))}`,
    );
  }

  const suggestions: SuggestionItem[] = [];

  for (const item of searchData.users || []) {
    if (item.user) suggestions.push(mapUser(item.user));
  }
  for (const item of searchData.hashtags || []) {
    if (item.hashtag) suggestions.push(mapHashtag(item.hashtag));
  }
  for (const item of searchData.places || []) {
    if (item.place) suggestions.push(mapPlace(item.place));
  }
  for (const item of searchData.see_more?.list || []) {
    if (item.keyword) suggestions.push(mapKeyword(item.keyword));
  }

  return { suggestions, totalCount: suggestions.length };
}

// ============================================================================
// getViewerSettings
// ============================================================================

interface IGWebFormDataResponse {
  form_data?: {
    first_name?: string;
    last_name?: string;
    email?: string;
    is_email_confirmed?: boolean;
    is_phone_confirmed?: boolean;
    username?: string;
    phone_number?: string;
    gender?: number;
    custom_gender?: string;
    birthday?: string | null;
    fb_birthday?: string | null;
    biography?: string;
    bio_links_for_web_edit_only?: Array<{ url?: string; title?: string }>;
    external_url?: string;
    chaining_enabled?: boolean;
    presence_disabled?: boolean;
    business_account?: boolean;
    usertag_review_enabled?: boolean;
    trusted_username?: string | null;
    trust_days?: number | null;
    profile_edit_params?: {
      username?: { is_pending_review?: boolean };
      full_name?: { is_pending_review?: boolean };
    };
  };
  status?: string;
}

interface IGSettingsContainerResponse {
  data?: {
    xdt__settings__get_screen_dependencies?: {
      boolean_server_values?: Array<{
        server_value_id?: string;
        value?: boolean;
      }>;
      boolean_settings?: Array<{ setting_id?: string; value?: boolean }>;
      string_server_values?: Array<{
        server_value_id?: string;
        value?: string;
      }>;
      string_settings?: Array<{ setting_id?: string; value?: string }>;
    };
  };
}

export async function getViewerSettings(
  params: GetViewerSettingsInput,
): Promise<GetViewerSettingsOutput> {
  const origin = window.location.origin;
  const userId = getCookie('ds_user_id') || '';

  // Fetch profile form data via REST endpoint
  const resp = await fetch(`${origin}/api/v1/accounts/edit/web_form_data/`, {
    method: 'GET',
    credentials: 'include',
    headers: {
      accept: '*/*',
      'accept-language': 'en-US,en;q=0.9',
      'x-csrftoken': params.csrf,
      'x-ig-app-id': getAppId(),
      'x-requested-with': 'XMLHttpRequest',
    },
  });

  // Detect redirect to login (fetch follows 302 → login page returns 200 HTML)
  const contentType = resp.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    throw new Unauthenticated(
      `getViewerSettings: received HTML instead of JSON from /api/v1/accounts/edit/web_form_data/. Session may be expired. URL: ${resp.url}`,
    );
  }

  if (!resp.ok) {
    const body = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, body);
  }

  const data: IGWebFormDataResponse = await resp.json();
  const fd = data.form_data;
  if (!fd) {
    throw new ContractDrift(
      `getViewerSettings: unexpected response shape. Keys: ${JSON.stringify(Object.keys(data))}`,
    );
  }

  // Read viewer profile data from PolarisViewer (browser-available, no network call)
  let profilePicUrl = '';
  let isProfessionalAccount = false;
  let category: string | null = null;
  const req = getRequire();
  if (req) {
    const viewer = req('PolarisViewer') as
      | {
          data?: {
            profile_pic_url?: string;
            is_professional_account?: boolean;
            category_name?: string | null;
          };
        }
      | undefined;
    if (viewer?.data) {
      profilePicUrl = viewer.data.profile_pic_url || '';
      isProfessionalAccount = viewer.data.is_professional_account === true;
      category = viewer.data.category_name || null;
    }
  }

  // Fetch settings container for privacy/verification booleans
  const settingsData = await graphqlPrimary<IGSettingsContainerResponse>(
    params.csrf,
    '24131322443213266',
    'PolarisSettingsDesktopContainerQuery',
    {},
  );
  const deps = settingsData?.data?.xdt__settings__get_screen_dependencies;
  let isVerified = false;
  let isPrivate = false;
  let accountType: string | null = null;
  let isSupervisionEnabled = false;
  let sensitiveContentControl: string | null = null;
  if (deps?.boolean_server_values) {
    for (const bv of deps.boolean_server_values) {
      if (bv.server_value_id === 'is_verified') isVerified = bv.value === true;
      if (bv.server_value_id === 'is_account_public')
        isPrivate = bv.value !== true;
      if (bv.server_value_id === 'is_supervision_enabled')
        isSupervisionEnabled = bv.value === true;
    }
  }
  if (deps?.boolean_settings) {
    for (const bs of deps.boolean_settings) {
      if (bs.setting_id === 'account_privacy_setting')
        isPrivate = bs.value === true;
    }
  }
  if (deps?.string_server_values) {
    for (const sv of deps.string_server_values) {
      if (sv.server_value_id === 'get_account_type')
        accountType = sv.value || null;
    }
  }
  if (deps?.string_settings) {
    for (const ss of deps.string_settings) {
      if (ss.setting_id === 'sensitive_content_control_v2')
        sensitiveContentControl = ss.value || null;
    }
  }

  const bioLinks = (fd.bio_links_for_web_edit_only || []).map((link) => ({
    url: link.url || '',
    title: link.title || '',
  }));

  return {
    userId,
    username: fd.username || '',
    fullName: [fd.first_name, fd.last_name].filter(Boolean).join(' '),
    firstName: fd.first_name || '',
    lastName: fd.last_name || '',
    email: fd.email || null,
    isEmailConfirmed: fd.is_email_confirmed === true,
    phoneNumber: fd.phone_number || null,
    isPhoneConfirmed: fd.is_phone_confirmed === true,
    isPrivate,
    isVerified,
    biography: fd.biography || '',
    externalUrl: fd.external_url || null,
    gender: fd.gender ?? 3,
    customGender: fd.custom_gender || null,
    birthday: fd.birthday || null,
    profilePicUrl,
    isBusiness: fd.business_account === true,
    isProfessionalAccount,
    category,
    chainingEnabled: fd.chaining_enabled === true,
    presenceDisabled: fd.presence_disabled === true,
    usertagReviewEnabled: fd.usertag_review_enabled === true,
    fbBirthday: fd.fb_birthday || null,
    bioLinks,
    trustedUsername: fd.trusted_username || null,
    trustDays: fd.trust_days ?? null,
    isUsernamePendingReview:
      fd.profile_edit_params?.username?.is_pending_review === true,
    isFullNamePendingReview:
      fd.profile_edit_params?.full_name?.is_pending_review === true,
    accountType,
    isSupervisionEnabled,
    sensitiveContentControl,
  };
}

// ============================================================================
// unsendMessage
// ============================================================================

interface IGUnsendMessageResponse {
  status?: string;
  message?: string;
}

export async function unsendMessage(
  params: UnsendMessageInput,
): Promise<UnsendMessageOutput> {
  const origin = window.location.origin;
  const url = `${origin}/api/v1/direct_v2/threads/${params.threadId}/items/${params.messageId}/delete/`;

  const resp = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: buildHeaders(params.csrf),
    body: new URLSearchParams().toString(),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, body);
  }

  const contentType = resp.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    throw new Unauthenticated(
      'unsendMessage: Instagram returned HTML instead of JSON. Session may be expired or CSRF token invalid.',
    );
  }

  const data: IGUnsendMessageResponse = await resp.json();

  if (data.status === 'fail') {
    throw new UpstreamError(
      `unsendMessage: Instagram returned failure. Message: ${data.message || 'unknown'}. Thread: ${params.threadId}, MessageId: ${params.messageId}`,
    );
  }

  return {
    success: data.status === 'ok',
  };
}
