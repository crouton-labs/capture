/**
 * Instagram Library: Profile Functions
 *
 * getUserProfile, getUserPosts, getUserReels, getUserTagged, getOwnProfile
 */

import { ContractDrift, Unauthenticated, Validation, throwForStatus } from '@vallum/_runtime';
import { getCookie, getAppId, buildHeaders, graphqlQuery } from './helpers';
// graphqlQuery retained for getUserTagged; getUserProfile now uses REST
import type {
  GetUserProfileInput,
  GetUserProfileOutput,
  ResolveUsernameInput,
  ResolveUsernameOutput,
  GetBusinessContactInput,
  GetBusinessContactOutput,
  GetUserPostsInput,
  GetUserPostsOutput,
  GetUserReelsInput,
  GetUserReelsOutput,
  GetUserTaggedInput,
  GetUserTaggedOutput,
  GetOwnProfileOutput,
  MediaNode,
} from './schemas';

// ============================================================================
// getUserProfile
// ============================================================================

interface IGProfileResponse {
  user?: {
    id?: string;
    pk?: string | number;
    username?: string;
    full_name?: string;
    biography?: string;
    profile_pic_url?: string;
    hd_profile_pic_url_info?: { url?: string };
    follower_count?: number;
    following_count?: number;
    media_count?: number;
    is_verified?: boolean;
    is_private?: boolean;
    external_url?: string | null;
    external_lynx_url?: string | null;
    category?: string | null;
    is_business?: boolean;
    is_professional_account?: boolean | null;
    pronouns?: string[];
  };
  status?: string;
}

// web_profile_info (username-keyed) response shape — differs from /info/ (id-keyed)
interface IGWebProfileUser {
  id?: string;
  fbid?: string;
  username?: string;
  full_name?: string;
  biography?: string;
  profile_pic_url?: string;
  profile_pic_url_hd?: string;
  edge_followed_by?: { count?: number };
  edge_follow?: { count?: number };
  edge_owner_to_timeline_media?: { count?: number };
  is_verified?: boolean;
  is_private?: boolean;
  external_url?: string | null;
  category_name?: string | null;
  category_enum?: string | null;
  is_business_account?: boolean;
  is_professional_account?: boolean;
  pronouns?: string[];
}

interface IGWebProfileResponse {
  data?: { user?: IGWebProfileUser };
  status?: string;
}

/**
 * Fetch the username-keyed web_profile_info endpoint. This is the canonical
 * username→userId bridge: it returns the numeric `id` (pk) plus a full profile.
 */
async function fetchWebProfileInfo(
  csrf: string,
  username: string,
): Promise<IGWebProfileUser> {
  const origin = window.location.origin;
  const resp = await fetch(
    `${origin}/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
    {
      method: 'GET',
      credentials: 'include',
      headers: buildHeaders(csrf),
    },
  );

  if (!resp.ok) {
    const body = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, body);
  }

  const rawContentType = resp.headers.get('content-type');
  const contentType = rawContentType !== null ? rawContentType : '';
  if (contentType.includes('text/html')) {
    throw new Unauthenticated(
      `web_profile_info: Instagram returned HTML instead of JSON for "${username}". Are you logged in? URL: ${window.location.href}`,
    );
  }

  // Strip the anti-JSON-hijacking prefix if present, then parse.
  const text = await resp.text();
  const cleaned = text.startsWith('for (;;);') ? text.slice(9) : text;
  let data: IGWebProfileResponse;
  try {
    data = JSON.parse(cleaned) as IGWebProfileResponse;
  } catch {
    throw new ContractDrift(
      `web_profile_info: unparseable response for "${username}". First 200 chars: ${text.slice(0, 200)}`,
    );
  }

  const user = data?.data?.user;
  if (!user) {
    throw new ContractDrift(
      `web_profile_info: no user found for "${username}". Top-level keys: ${JSON.stringify(Object.keys(data || {}))}`,
    );
  }
  return user;
}

/** Normalize web_profile_info's user object into the shared UserProfile shape. */
function normalizeWebProfile(
  user: IGWebProfileUser,
  username: string,
): GetUserProfileOutput {
  const profilePicUrl = user.profile_pic_url_hd || user.profile_pic_url || '';
  return {
    userId: String(user.id || ''),
    username: user.username || username,
    fullName: user.full_name || '',
    biography: user.biography || '',
    profilePicUrl,
    followerCount: user.edge_followed_by?.count ?? 0,
    followingCount: user.edge_follow?.count ?? 0,
    postCount: user.edge_owner_to_timeline_media?.count ?? 0,
    isVerified: Boolean(user.is_verified),
    isPrivate: Boolean(user.is_private),
    externalUrl: user.external_url || null,
    category: user.category_name || null,
    isBusiness: Boolean(user.is_business_account),
    isProfessionalAccount: Boolean(user.is_professional_account),
    pronouns: user.pronouns || [],
  };
}

export async function getUserProfile(
  params: GetUserProfileInput,
): Promise<GetUserProfileOutput> {
  if (!params.username && !params.userId) {
    throw new Validation(
      'getUserProfile: provide exactly one of `username` or `userId`.',
    );
  }

  // Username path: web_profile_info returns the full profile and the numeric id.
  if (params.username) {
    const user = await fetchWebProfileInfo(params.csrf, params.username);
    return normalizeWebProfile(user, params.username);
  }

  // userId path: the id-keyed /info/ endpoint.
  const origin = window.location.origin;
  const resp = await fetch(`${origin}/api/v1/users/${params.userId}/info/`, {
    method: 'GET',
    credentials: 'include',
    headers: buildHeaders(params.csrf),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, body);
  }

  const rawContentType = resp.headers.get('content-type');
  const contentType = rawContentType !== null ? rawContentType : '';
  if (contentType.includes('text/html')) {
    throw new Unauthenticated(
      `getUserProfile: Instagram returned HTML instead of JSON for user ${params.userId}. Are you logged in? URL: ${window.location.href}`,
    );
  }

  const data = (await resp.json()) as IGProfileResponse;

  const user = data?.user;
  if (!user) {
    throw new ContractDrift(
      `Failed to parse profile response for user ${params.userId}. Keys found: ${JSON.stringify(Object.keys(data || {}))}`,
    );
  }

  // HD profile pic from hd_profile_pic_url_info or fallback to profile_pic_url
  const profilePicUrl =
    user.hd_profile_pic_url_info?.url || user.profile_pic_url || '';

  return {
    userId: String(user.pk || user.id || params.userId),
    username: user.username || '',
    fullName: user.full_name || '',
    biography: user.biography || '',
    profilePicUrl,
    followerCount: user.follower_count ?? 0,
    followingCount: user.following_count ?? 0,
    postCount: user.media_count ?? 0,
    isVerified: Boolean(user.is_verified),
    isPrivate: Boolean(user.is_private),
    externalUrl: user.external_url || user.external_lynx_url || null,
    category: user.category || null,
    isBusiness: Boolean(user.is_business),
    isProfessionalAccount: Boolean(user.is_professional_account),
    pronouns: user.pronouns || [],
  };
}

// ============================================================================
// resolveUsername — the username↔userId bridge
// ============================================================================

export async function resolveUsername(
  params: ResolveUsernameInput,
): Promise<ResolveUsernameOutput> {
  const user = await fetchWebProfileInfo(params.csrf, params.username);
  const userId = String(user.id || '');
  if (!userId) {
    throw new ContractDrift(
      `resolveUsername: web_profile_info returned no numeric id for "${params.username}".`,
    );
  }
  return {
    userId,
    username: user.username || params.username,
    fullName: user.full_name || '',
    isPrivate: Boolean(user.is_private),
    isVerified: Boolean(user.is_verified),
  };
}

// ============================================================================
// getBusinessContact — public contact details (lead enrichment / prospecting)
//
// The /api/v1/users/{id}/info/ endpoint exposes contact fields that the public
// web_profile_info hides (phone, public email, full address). Instagram only
// returns what the account chose to make public, so fields are often empty.
// ============================================================================

interface IGContactInfoUser {
  pk?: string | number;
  id?: string;
  username?: string;
  full_name?: string;
  is_business?: boolean;
  is_professional_account?: boolean | null;
  category?: string | null;
  public_email?: string;
  public_phone_number?: string;
  public_phone_country_code?: string;
  contact_phone_number?: string;
  business_contact_method?: string;
  city_name?: string;
  address_street?: string;
  zip?: string;
  latitude?: number | null;
  longitude?: number | null;
  additional_business_addresses?: unknown[];
  external_url?: string | null;
  bio_links?: Array<{ title?: string; url?: string; lynx_url?: string }>;
}

/** Normalize empty strings to null so absent contact fields read cleanly. */
function emptyToNull(v: string | undefined): string | null {
  return v !== undefined && v !== '' ? v : null;
}

export async function getBusinessContact(
  params: GetBusinessContactInput,
): Promise<GetBusinessContactOutput> {
  if (!params.username && !params.userId) {
    throw new Validation(
      'getBusinessContact: provide exactly one of `username` or `userId`.',
    );
  }

  // Resolve to a numeric id (the /info/ endpoint is id-keyed).
  let userId = params.userId;
  if (!userId && params.username) {
    const resolved = await fetchWebProfileInfo(params.csrf, params.username);
    userId = String(resolved.id || '');
    if (!userId) {
      throw new ContractDrift(
        `getBusinessContact: could not resolve "${params.username}" to a user id.`,
      );
    }
  }

  const origin = window.location.origin;
  const resp = await fetch(`${origin}/api/v1/users/${userId}/info/`, {
    method: 'GET',
    credentials: 'include',
    headers: buildHeaders(params.csrf),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, body);
  }

  const rawContentType = resp.headers.get('content-type');
  const contentType = rawContentType !== null ? rawContentType : '';
  if (contentType.includes('text/html')) {
    throw new Unauthenticated(
      `getBusinessContact: Instagram returned HTML instead of JSON for user ${userId}. Are you logged in?`,
    );
  }

  const data = (await resp.json()) as { user?: IGContactInfoUser };
  const user = data?.user;
  if (!user) {
    throw new ContractDrift(
      `getBusinessContact: no user in /info/ response for ${userId}. Keys: ${JSON.stringify(Object.keys(data || {}))}`,
    );
  }

  const bioLinks = (user.bio_links || []).map((l) => ({
    title: l.title || '',
    url: l.url || l.lynx_url || '',
  }));

  const additional = user.additional_business_addresses;
  const additionalAddressCount = Array.isArray(additional) ? additional.length : 0;

  return {
    userId: String(user.pk || user.id || userId),
    username: user.username || '',
    fullName: user.full_name || '',
    isBusiness: Boolean(user.is_business),
    isProfessional: Boolean(user.is_professional_account),
    category: user.category || null,
    publicEmail: emptyToNull(user.public_email),
    publicPhoneNumber: emptyToNull(user.public_phone_number),
    publicPhoneCountryCode: emptyToNull(user.public_phone_country_code),
    contactPhoneNumber: emptyToNull(user.contact_phone_number),
    contactMethod: emptyToNull(user.business_contact_method),
    address: {
      street: emptyToNull(user.address_street),
      cityName: emptyToNull(user.city_name),
      zip: emptyToNull(user.zip),
      latitude: user.latitude !== undefined ? user.latitude : null,
      longitude: user.longitude !== undefined ? user.longitude : null,
    },
    additionalAddressCount,
    externalUrl: user.external_url || null,
    bioLinks,
  };
}

// ============================================================================
// Response interfaces
// ============================================================================

interface MediaEdgeNode {
  id?: string;
  shortcode?: string;
  display_url?: string;
  edge_media_to_caption?: {
    edges?: Array<{ node?: { text?: string } }>;
  };
  edge_media_preview_like?: { count?: number };
  edge_media_to_comment?: { count?: number };
  taken_at_timestamp?: number;
  is_video?: boolean;
  video_view_count?: number | null;
  accessibility_caption?: string | null;
}

interface _MediaEdge {
  node?: MediaEdgeNode;
}

interface _PageInfo {
  has_next_page?: boolean;
}

interface ClipsUserResponse {
  items?: Array<{ media?: XdtMediaNode }>;
  paging_info?: { max_id?: string; more_available?: boolean };
  status?: string;
}

interface IGUserTaggedResponse {
  data?: {
    xdt_api__v1__usertags__user_id__feed_connection?: {
      edges?: Array<{ node?: XdtMediaNode }>;
      page_info?: {
        has_next_page?: boolean;
        end_cursor?: string | null;
        has_previous_page?: boolean;
        start_cursor?: string | null;
      };
    };
  };
}

interface IGEditFormResponse {
  form_data?: {
    first_name?: string;
    last_name?: string;
    biography?: string;
    external_url?: string;
    bio_links_for_web_edit_only?: Array<{ title?: string; url?: string }>;
    email?: string;
    is_email_confirmed?: boolean;
    phone_number?: string;
    is_phone_confirmed?: boolean;
    gender?: number;
    custom_gender?: string;
    username?: string;
    birthday?: string | null;
    fb_birthday?: string | null;
    chaining_enabled?: boolean;
    presence_disabled?: boolean;
    business_account?: boolean;
    usertag_review_enabled?: boolean;
    trusted_username?: string | null;
    trust_days?: number | null;
    profile_edit_params?: {
      username?: {
        should_show_confirmation_dialog?: boolean;
        is_pending_review?: boolean;
        confirmation_dialog_text?: string;
        disclaimer_text?: string;
      };
      full_name?: {
        should_show_confirmation_dialog?: boolean;
        is_pending_review?: boolean;
        confirmation_dialog_text?: string;
        disclaimer_text?: string;
      };
    };
  };
}

// ============================================================================
// Media node normalization
// ============================================================================

function _normalizeMediaNode(node: MediaEdgeNode): MediaNode {
  if (!node.id) throw new ContractDrift('normalizeMediaNode: media node missing id');
  if (!node.display_url)
    throw new ContractDrift(
      `normalizeMediaNode: media node ${node.id} missing display_url`,
    );
  if (!node.shortcode)
    throw new ContractDrift(
      `normalizeMediaNode: media node ${node.id} missing shortcode`,
    );
  if (node.taken_at_timestamp === undefined)
    throw new ContractDrift(
      `normalizeMediaNode: media node ${node.id} missing taken_at_timestamp`,
    );

  const captionText = node.edge_media_to_caption?.edges?.[0]?.node?.text;
  const caption: string | null = captionText !== undefined ? captionText : null;

  const rawLikeCount = node.edge_media_preview_like?.count;
  const likeCount = rawLikeCount !== undefined ? rawLikeCount : 0;

  const rawCommentCount = node.edge_media_to_comment?.count;
  const commentCount = rawCommentCount !== undefined ? rawCommentCount : 0;

  const videoViewCount: number | null =
    node.video_view_count !== undefined ? node.video_view_count : null;
  const accessibilityCaption: string | null =
    node.accessibility_caption !== undefined
      ? node.accessibility_caption
      : null;

  return {
    id: node.id,
    shortcode: node.shortcode,
    displayUrl: node.display_url,
    caption,
    likeCount,
    commentCount,
    takenAt: node.taken_at_timestamp,
    isVideo: Boolean(node.is_video),
    videoViewCount,
    accessibilityCaption,
  };
}

// ============================================================================
// getUserPosts
// ============================================================================

interface IGUserPostsXdtResponse {
  data?: {
    xdt_api__v1__feed__user_timeline_graphql_connection?: {
      edges?: Array<{ node?: XdtMediaNode }>;
      page_info?: { has_next_page?: boolean; end_cursor?: string | null };
    };
  };
}

interface XdtMediaNode {
  id?: string;
  pk?: string;
  code?: string;
  caption?: { text?: string } | null;
  like_count?: number;
  comment_count?: number;
  taken_at?: number;
  media_type?: number;
  view_count?: number | null;
  play_count?: number | null;
  image_versions2?: { candidates?: Array<{ url?: string }> };
  accessibility_caption?: string | null;
}

function normalizeXdtMediaNode(node: XdtMediaNode): MediaNode {
  const id = node.id || (node.pk !== undefined ? String(node.pk) : '');
  if (!id) throw new ContractDrift('getUserPosts: media node missing id');
  if (!node.code)
    throw new ContractDrift(`normalizeXdtMediaNode: media node ${id} missing code`);

  const displayUrl = node.image_versions2?.candidates?.[0]?.url || '';
  const caption: string | null =
    node.caption?.text !== undefined ? node.caption.text : null;
  const likeCount = node.like_count !== undefined ? node.like_count : 0;
  const commentCount =
    node.comment_count !== undefined ? node.comment_count : 0;
  const isVideo = node.media_type === 2;
  const videoViewCount: number | null =
    node.view_count !== undefined ? node.view_count : null;
  const accessibilityCaption: string | null =
    node.accessibility_caption !== undefined
      ? node.accessibility_caption
      : null;
  const takenAt = node.taken_at !== undefined ? node.taken_at : 0;

  return {
    id,
    shortcode: node.code,
    displayUrl,
    caption,
    likeCount,
    commentCount,
    takenAt,
    isVideo,
    videoViewCount,
    accessibilityCaption,
  };
}

export async function getUserPosts(
  params: GetUserPostsInput,
): Promise<GetUserPostsOutput> {
  const count = params.count !== undefined ? params.count : 12;

  const data = await graphqlQuery<IGUserPostsXdtResponse>(
    params.csrf,
    '25848791338108280',
    'PolarisProfilePostsQuery',
    {
      username: params.username,
      data: {
        count,
        include_reel_media_seen_timestamp: true,
        include_relationship_info: true,
        latest_besties_reel_media: true,
        latest_reel_media: true,
      },
    },
  );

  const conn = data?.data?.xdt_api__v1__feed__user_timeline_graphql_connection;
  if (!conn) {
    throw new ContractDrift(
      `getUserPosts: unexpected response shape for user "${params.username}". Data keys: ${JSON.stringify(Object.keys(data?.data || {}))}`,
    );
  }

  const edges = conn.edges !== undefined ? conn.edges : [];
  const posts = edges
    .map((e) => e.node)
    .filter((n): n is XdtMediaNode => n !== undefined)
    .map(normalizeXdtMediaNode);

  const hasMore = conn.page_info?.has_next_page === true;

  return { posts, totalCount: posts.length, hasMore };
}

// ============================================================================
// Reel node normalization (REST /api/v1/clips/user/ format)
// ============================================================================

function normalizeReelNode(node: XdtMediaNode): MediaNode {
  const id = node.pk !== undefined ? String(node.pk) : node.id || '';
  if (!id) throw new ContractDrift('getUserReels: reel node missing id');
  if (!node.code) throw new ContractDrift(`getUserReels: reel node ${id} missing code`);

  const displayUrl = node.image_versions2?.candidates?.[0]?.url || '';
  const caption: string | null =
    node.caption?.text !== undefined ? node.caption.text : null;
  const likeCount = node.like_count !== undefined ? node.like_count : 0;
  const commentCount =
    node.comment_count !== undefined ? node.comment_count : 0;
  const takenAt = node.taken_at !== undefined ? node.taken_at : 0;
  const isVideo = node.media_type === 2;
  // REST endpoint returns play_count for reels; view_count is typically null
  const videoViewCount: number | null =
    node.play_count !== undefined && node.play_count !== null
      ? node.play_count
      : node.view_count !== undefined
        ? node.view_count
        : null;
  const accessibilityCaption: string | null =
    node.accessibility_caption !== undefined
      ? node.accessibility_caption
      : null;

  return {
    id,
    shortcode: node.code,
    displayUrl,
    caption,
    likeCount,
    commentCount,
    takenAt,
    isVideo,
    videoViewCount,
    accessibilityCaption,
  };
}

// ============================================================================
// getUserReels
// ============================================================================

export async function getUserReels(
  params: GetUserReelsInput,
): Promise<GetUserReelsOutput> {
  const pageSize = params.pageSize !== undefined ? params.pageSize : 12;
  const includeFeedVideo =
    params.includeFeedVideo !== undefined ? params.includeFeedVideo : true;

  const origin = window.location.origin;
  const formParams = new URLSearchParams({
    target_user_id: params.userId,
    page_size: String(pageSize),
    include_feed_video: String(includeFeedVideo),
  });

  if (params.cursor) {
    formParams.set('max_id', params.cursor);
  }

  const resp = await fetch(`${origin}/api/v1/clips/user/`, {
    method: 'POST',
    credentials: 'include',
    headers: buildHeaders(params.csrf),
    body: formParams.toString(),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, body);
  }

  const data: ClipsUserResponse = await resp.json();

  const items = data.items || [];
  const reels = items
    .map((item) => item.media)
    .filter((n): n is XdtMediaNode => n !== undefined)
    .map(normalizeReelNode);

  const hasMore = data.paging_info?.more_available === true;
  const cursor = hasMore ? (data.paging_info?.max_id ?? null) : null;

  return { reels, totalCount: reels.length, hasMore, cursor };
}

// ============================================================================
// getUserTagged
// ============================================================================

export async function getUserTagged(
  params: GetUserTaggedInput,
): Promise<GetUserTaggedOutput> {
  if (!params.userId) {
    throw new Validation('getUserTagged: userId is required but was not provided');
  }

  const count = Math.max(
    1,
    Math.min(12, params.count !== undefined ? params.count : 12),
  );

  let data: IGUserTaggedResponse;

  if (params.cursor) {
    // Subsequent page: use the connection query with Relay pagination variables
    data = await graphqlQuery<IGUserTaggedResponse>(
      params.csrf,
      '25420162567607189',
      'PolarisProfileTaggedTabContentQuery_connection',
      {
        after: params.cursor,
        before: null,
        count,
        first: count,
        last: null,
        user_id: params.userId,
      },
    );
  } else {
    // First page: use the initial query
    data = await graphqlQuery<IGUserTaggedResponse>(
      params.csrf,
      '24911879781839405',
      'PolarisProfileTaggedTabContentQuery',
      {
        user_id: params.userId,
        count,
      },
    );
  }

  const conn = data?.data?.xdt_api__v1__usertags__user_id__feed_connection;
  if (!conn) {
    // No connection (private account or no tagged posts)
    return { posts: [], totalCount: 0, hasMore: false, cursor: null };
  }

  const edges = conn.edges !== undefined ? conn.edges : [];
  const posts = edges
    .map((e) => e.node)
    .filter((n): n is XdtMediaNode => n !== undefined)
    .map(normalizeXdtMediaNode);

  const hasMore = conn.page_info?.has_next_page === true;
  const rawCursor = conn.page_info?.end_cursor;
  // API returns "None" string for empty results; normalize to null
  const cursor = rawCursor && rawCursor !== 'None' ? rawCursor : null;

  return { posts, totalCount: posts.length, hasMore, cursor };
}

// ============================================================================
// getOwnProfile
// ============================================================================

export async function getOwnProfile(): Promise<GetOwnProfileOutput> {
  const csrf = getCookie('csrftoken');
  if (!csrf) {
    throw new Unauthenticated(
      `getOwnProfile: CSRF token not found in cookies. Are you logged into Instagram? URL: ${window.location.href}`,
    );
  }

  const resp = await fetch(
    `${window.location.origin}/api/v1/accounts/edit/web_form_data/`,
    {
      method: 'GET',
      credentials: 'include',
      headers: {
        accept: '*/*',
        'accept-language': 'en-US,en;q=0.9',
        'x-csrftoken': csrf,
        'x-ig-app-id': getAppId(),
        'x-requested-with': 'XMLHttpRequest',
      },
    },
  );

  if (!resp.ok) {
    const body = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, body);
  }

  const data: IGEditFormResponse = await resp.json();
  const fd = data.form_data;
  if (!fd) {
    throw new ContractDrift(
      `getOwnProfile: unexpected response shape. Keys: ${JSON.stringify(Object.keys(data))}`,
    );
  }

  if (!fd.username)
    throw new ContractDrift('getOwnProfile: form_data missing username');
  if (!fd.email) throw new ContractDrift('getOwnProfile: form_data missing email');

  const firstName = fd.first_name !== undefined ? fd.first_name : '';
  const lastName = fd.last_name !== undefined ? fd.last_name : '';
  const biography = fd.biography !== undefined ? fd.biography : '';
  const externalUrl = fd.external_url !== undefined ? fd.external_url : '';
  const bioLinks = (fd.bio_links_for_web_edit_only || []).map((l) => ({
    title: l.title || '',
    url: l.url || '',
  }));
  const phoneNumber = fd.phone_number !== undefined ? fd.phone_number : '';
  const gender = fd.gender !== undefined ? fd.gender : 0;
  const customGender = fd.custom_gender !== undefined ? fd.custom_gender : '';
  const birthday = fd.birthday || null;
  const chainingEnabled = fd.chaining_enabled === true;
  const presenceDisabled = fd.presence_disabled === true;
  const businessAccount = fd.business_account === true;
  const usertagReviewEnabled = fd.usertag_review_enabled === true;
  const trustedUsername = fd.trusted_username || null;
  const trustDays = fd.trust_days !== undefined ? fd.trust_days : null;

  const rawEditParams = fd.profile_edit_params;
  const defaultEditEntry = {
    shouldShowConfirmationDialog: false,
    isPendingReview: false,
    confirmationDialogText: '',
    disclaimerText: '',
  };
  const profileEditParams = {
    username: rawEditParams?.username
      ? {
          shouldShowConfirmationDialog:
            rawEditParams.username.should_show_confirmation_dialog === true,
          isPendingReview: rawEditParams.username.is_pending_review === true,
          confirmationDialogText:
            rawEditParams.username.confirmation_dialog_text || '',
          disclaimerText: rawEditParams.username.disclaimer_text || '',
        }
      : defaultEditEntry,
    fullName: rawEditParams?.full_name
      ? {
          shouldShowConfirmationDialog:
            rawEditParams.full_name.should_show_confirmation_dialog === true,
          isPendingReview: rawEditParams.full_name.is_pending_review === true,
          confirmationDialogText:
            rawEditParams.full_name.confirmation_dialog_text || '',
          disclaimerText: rawEditParams.full_name.disclaimer_text || '',
        }
      : defaultEditEntry,
  };

  return {
    username: fd.username,
    firstName,
    lastName,
    biography,
    externalUrl,
    bioLinks,
    email: fd.email,
    isEmailConfirmed: fd.is_email_confirmed === true,
    phoneNumber,
    isPhoneConfirmed: fd.is_phone_confirmed === true,
    gender,
    customGender,
    birthday,
    chainingEnabled,
    presenceDisabled,
    businessAccount,
    usertagReviewEnabled,
    trustedUsername,
    trustDays,
    profileEditParams,
  };
}
