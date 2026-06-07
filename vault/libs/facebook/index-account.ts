/**
 * Facebook Library: Account (viewer's own profile edits)
 *
 * Operations that act on the authenticated viewer's own account/profile.
 * Distinct from index-profile.ts, which browses any profile by userID.
 */

import {
  buildRoutePath,
  getRouteDefinition,
  getViewerUserId,
  graphql,
} from './helpers';
import type {
  SearchLocationsInput,
  SearchLocationsOutput,
  SearchHubsInput,
  SearchHubsOutput,
  ListProfilePictureCandidatesOutput,
  ListCoverPhotoCandidatesOutput,
  UpdateCurrentCityInput,
  UpdateCurrentCityOutput,
  UpdateHometownInput,
  UpdateHometownOutput,
  UpdateRelationshipStatusInput,
  UpdateRelationshipStatusOutput,
  SetProfilePictureInput,
  SetProfilePictureOutput,
  SetCoverPhotoInput,
  SetCoverPhotoOutput,
  AddEducationExperienceInput,
  AddEducationExperienceOutput,
} from './schemas-account';

// ============================================================================
// Internal helpers
// ============================================================================

let mutationCounter = 0;
function nextMutationId(): string {
  mutationCounter += 1;
  return `${Date.now()}-${mutationCounter}`;
}

const DEFAULT_PRIVACY = {
  allow: [],
  base_state: 'EVERYONE',
  deny: [],
  tag_expansion_state: 'UNSPECIFIED',
} as const;

// Stable synthetic nav-chain. Facebook uses this for analytics, not auth.
// If a mutation starts returning 4xx, recapture from live traffic.
const NAV_CHAIN =
  'ProfileCometAboutTabRoot.react,comet.profile.collection.about,unexpected,0,0,,,';

const ATTRIBUTION_ID =
  'ProfileCometTimelineListViewRoot.react,comet.profile.timeline.list,unexpected,0,0,,,';

interface AboutTokens {
  collectionToken: string;
  sectionToken: string;
}

/**
 * Resolve the about_overview section/collection tokens for the viewer's own
 * profile. All four about-tab field-save mutations require these tokens and
 * they're only mintable via /ajax/route-definition/.
 */
async function resolveAboutTokens(viewerId: string): Promise<AboutTokens> {
  const tokens = await getRouteDefinition(
    buildRoutePath(viewerId, 'about_overview'),
  );
  if (!tokens.collectionToken || !tokens.sectionToken) {
    throw new Error(
      `Facebook did not mint about_overview section/collection tokens for viewerId=${viewerId}.`,
    );
  }
  return {
    collectionToken: tokens.collectionToken,
    sectionToken: tokens.sectionToken,
  };
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function asNumber(v: unknown): number | null {
  return typeof v === 'number' ? v : null;
}

// ============================================================================
// searchLocations
// ============================================================================

interface RawLocationResponse {
  data?: {
    city_street_search?: {
      street_results?: {
        edges?: Array<{
          node?: {
            city?: { id?: unknown };
            location?: { latitude?: unknown; longitude?: unknown };
            title?: unknown;
            page?: { id?: unknown; page_logo?: { uri?: unknown } };
          };
        }>;
      };
    };
  };
}

export async function searchLocations(
  params: SearchLocationsInput,
): Promise<SearchLocationsOutput> {
  const viewerId = getViewerUserId();
  const max = params.maxResults ?? 10;

  const raw = await graphql<RawLocationResponse>(
    viewerId,
    '9786042511478330',
    'useProfileCometLocationTypeaheadDataSourceQuery',
    {
      params: {
        caller: 'PROFILE_ABOUT',
        country_filter: null,
        geocode_fallback: false,
        integration_strategy: 'STRING_MATCH',
        page_category: ['CITY', 'SUBCITY'],
        provider: 'HERE_THRIFT',
        query: params.query,
        radius: null,
        result_ordering: 'INTERLEAVE',
        search_type: 'CITY_TYPEAHEAD',
      },
      max_results: max,
      photo_width: 50,
      photo_height: 50,
    },
  );

  const edges = raw.data?.city_street_search?.street_results?.edges ?? [];
  const results = edges.map((e) => {
    const n = e.node ?? {};
    const cityId = asString(n.city?.id) || asString(n.page?.id);
    return {
      id: cityId,
      title: asString(n.title),
      latitude: asNumber(n.location?.latitude),
      longitude: asNumber(n.location?.longitude),
      pageLogoUrl: asString(n.page?.page_logo?.uri) || null,
    };
  });

  return { results, raw: raw.data };
}

// ============================================================================
// searchHubs
// ============================================================================

interface RawHubsResponse {
  data?: {
    viewer?: {
      eligible_hubs?: {
        nodes?: Array<{
          name?: unknown;
          id?: unknown;
          page_logo?: { uri?: unknown };
        }>;
      };
    };
  };
}

export async function searchHubs(
  params: SearchHubsInput,
): Promise<SearchHubsOutput> {
  const viewerId = getViewerUserId();
  const first = params.first ?? 10;

  const raw = await graphql<RawHubsResponse>(
    viewerId,
    '30008033178843626',
    'useProfileCometHubsTypeaheadDataSourceQuery',
    {
      section: params.section,
      query: params.query,
      first,
      photo_size: 50,
    },
  );

  const nodes = raw.data?.viewer?.eligible_hubs?.nodes ?? [];
  const results = nodes.map((n) => ({
    id: asString(n.id),
    name: asString(n.name),
    pageLogoUrl: asString(n.page_logo?.uri) || null,
  }));

  return { results, raw: raw.data };
}

// ============================================================================
// listProfilePictureCandidates / listCoverPhotoCandidates (shared shape)
// ============================================================================

interface RawMediaPickerResponse {
  data?: {
    viewer?: {
      media_sets?: {
        edges?: Array<{
          node?: {
            id?: unknown;
            title?: { text?: unknown };
            media_set_type?: unknown;
            media?: {
              edges?: Array<{
                node?: {
                  id?: unknown;
                  image?: { uri?: unknown; width?: unknown; height?: unknown };
                  accessibility_caption?: unknown;
                };
              }>;
            };
            preview?: {
              nodes?: Array<{
                id?: unknown;
                image?: { uri?: unknown };
              }>;
            };
          };
        }>;
      };
    };
  };
}

function parseMediaPicker(raw: RawMediaPickerResponse) {
  const edges = raw.data?.viewer?.media_sets?.edges ?? [];
  return edges.map((e) => {
    const n = e.node ?? {};
    const mediaEdges = n.media?.edges ?? [];
    const photos = mediaEdges.map((me) => {
      const p = me.node ?? {};
      return {
        id: asString(p.id),
        imageUrl: asString(p.image?.uri) || null,
        accessibilityCaption: asString(p.accessibility_caption) || null,
        width: asNumber(p.image?.width),
        height: asNumber(p.image?.height),
      };
    });
    // Some sets only expose `preview.nodes` (not full `media.edges`)
    if (photos.length === 0 && n.preview?.nodes) {
      for (const p of n.preview.nodes) {
        photos.push({
          id: asString(p.id),
          imageUrl: asString(p.image?.uri) || null,
          accessibilityCaption: null,
          width: null,
          height: null,
        });
      }
    }
    return {
      id: asString(n.id),
      title: asString(n.title?.text),
      mediaSetType: asString(n.media_set_type),
      photos,
    };
  });
}

export async function listProfilePictureCandidates(): Promise<ListProfilePictureCandidatesOutput> {
  const viewerId = getViewerUserId();
  const raw = await graphql<RawMediaPickerResponse>(
    viewerId,
    '26950762227875381',
    'ProfileCometProfilePictureEditDialogQuery',
    { scale: 1 },
  );
  return { mediaSets: parseMediaPicker(raw), raw: raw.data };
}

export async function listCoverPhotoCandidates(): Promise<ListCoverPhotoCandidatesOutput> {
  const viewerId = getViewerUserId();
  const raw = await graphql<RawMediaPickerResponse>(
    viewerId,
    '26111560378482965',
    'ProfileCometCoverPhotoMediaPickerDialogQuery',
    { scale: 1 },
  );
  return { mediaSets: parseMediaPicker(raw), raw: raw.data };
}

// ============================================================================
// updateCurrentCity
// ============================================================================

interface RawCurrentCitySaveResponse {
  data?: {
    current_city_profile_field_save?: {
      viewer?: {
        actor?: {
          current_city?: { id?: unknown; name?: unknown };
        };
      };
    };
  };
}

export async function updateCurrentCity(
  params: UpdateCurrentCityInput,
): Promise<UpdateCurrentCityOutput> {
  const viewerId = getViewerUserId();
  const { collectionToken, sectionToken } = await resolveAboutTokens(viewerId);

  const raw = await graphql<RawCurrentCitySaveResponse>(
    viewerId,
    '26476531018655054',
    'ProfileCometCurrentCityProfileFieldSaveMutation',
    {
      collectionToken,
      input: {
        current_city_id: params.cityId,
        life_event_publish_type: null,
        logging_data: { nav_chain: NAV_CHAIN },
        privacy: DEFAULT_PRIVACY,
        actor_id: viewerId,
        client_mutation_id: nextMutationId(),
      },
      scale: 1,
      sectionToken,
      profileID: viewerId,
      useDefaultActor: false,
    },
  );

  const cc =
    raw.data?.current_city_profile_field_save?.viewer?.actor?.current_city;
  return {
    currentCity: cc ? { id: asString(cc.id), name: asString(cc.name) } : null,
    raw: raw.data,
  };
}

// ============================================================================
// updateHometown
// ============================================================================

interface RawHometownSaveResponse {
  data?: {
    hometown_profile_field_save?: {
      viewer?: {
        actor?: {
          hometown?: { id?: unknown; name?: unknown };
        };
      };
    };
  };
}

export async function updateHometown(
  params: UpdateHometownInput,
): Promise<UpdateHometownOutput> {
  const viewerId = getViewerUserId();
  const { collectionToken, sectionToken } = await resolveAboutTokens(viewerId);

  const raw = await graphql<RawHometownSaveResponse>(
    viewerId,
    '34859167637032276',
    'ProfileCometHometownProfileFieldSaveMutation',
    {
      collectionToken,
      input: {
        hometown_city_id: params.cityId,
        life_event_publish_type: null,
        logging_data: { nav_chain: NAV_CHAIN },
        privacy: DEFAULT_PRIVACY,
        actor_id: viewerId,
        client_mutation_id: nextMutationId(),
      },
      scale: 1,
      sectionToken,
      useDefaultActor: false,
    },
  );

  const hometown =
    raw.data?.hometown_profile_field_save?.viewer?.actor?.hometown;
  return {
    hometown: hometown
      ? { id: asString(hometown.id), name: asString(hometown.name) }
      : null,
    raw: raw.data,
  };
}

// ============================================================================
// updateRelationshipStatus
// ============================================================================

export async function updateRelationshipStatus(
  params: UpdateRelationshipStatusInput,
): Promise<UpdateRelationshipStatusOutput> {
  const viewerId = getViewerUserId();
  const { collectionToken, sectionToken } = await resolveAboutTokens(viewerId);

  const raw = await graphql<{ data?: unknown }>(
    viewerId,
    '26471472572516687',
    'ProfileCometUserUpdateRelationshipStatusMutation',
    {
      collectionToken,
      input: {
        life_event_publish_type: null,
        privacy: DEFAULT_PRIVACY,
        status_const: params.status,
        subtitle: null,
        logging_data: { nav_chain: NAV_CHAIN },
        actor_id: viewerId,
        client_mutation_id: nextMutationId(),
      },
      scale: 1,
      sectionToken,
      useDefaultActor: false,
    },
  );

  return { raw: raw.data };
}

// ============================================================================
// setProfilePicture
// ============================================================================

export async function setProfilePicture(
  params: SetProfilePictureInput,
): Promise<SetProfilePictureOutput> {
  const viewerId = getViewerUserId();
  const skipCropping = params.skipCropping ?? true;

  const raw = await graphql<{ data?: unknown }>(
    viewerId,
    '27096116679985959',
    'ProfileCometProfilePictureSetMutation',
    {
      input: {
        attribution_id_v2: ATTRIBUTION_ID,
        caption: '',
        existing_photo_id: params.photoId,
        expiration_time: null,
        profile_id: viewerId,
        profile_pic_method: 'EXISTING',
        profile_pic_source: 'TIMELINE',
        scaled_crop_rect: params.scaledCropRect ?? {
          height: 1,
          width: 1,
          x: 0,
          y: 0,
        },
        skip_cropping: skipCropping,
        actor_id: viewerId,
        client_mutation_id: nextMutationId(),
      },
      isPage: false,
      isProfile: true,
      scale: 1,
      __relay_internal__pv__ProfileGeminiIsCoinFlipEnabledrelayprovider: false,
    },
  );

  return { raw: raw.data };
}

// ============================================================================
// setCoverPhoto
// ============================================================================

export async function setCoverPhoto(
  params: SetCoverPhotoInput,
): Promise<SetCoverPhotoOutput> {
  const viewerId = getViewerUserId();
  const focus = params.focus ?? { x: 0.5, y: 0.5 };

  const raw = await graphql<{ data?: unknown }>(
    viewerId,
    '26517770824507733',
    'ProfileCometCoverPhotoUpdateMutation',
    {
      input: {
        attribution_id_v2: ATTRIBUTION_ID,
        cover_photo_id: params.photoId,
        focus,
        target_user_id: viewerId,
        actor_id: viewerId,
        client_mutation_id: nextMutationId(),
      },
      scale: 1,
      contextualProfileContext: null,
    },
  );

  return { raw: raw.data };
}

// ============================================================================
// addEducationExperience
// ============================================================================

export async function addEducationExperience(
  params: AddEducationExperienceInput,
): Promise<AddEducationExperienceOutput> {
  const viewerId = getViewerUserId();
  const { collectionToken, sectionToken } = await resolveAboutTokens(viewerId);

  // Captured payload always sent exactly 3 concentration slots; pad with
  // empty slots if fewer were provided.
  const concentrations = [...(params.concentrations ?? [])];
  while (concentrations.length < 3) concentrations.push({ id: '', name: '' });

  const start =
    typeof params.startYear === 'number' ? { year: params.startYear } : {};
  const end =
    typeof params.endYear === 'number' ? { year: params.endYear } : {};

  const raw = await graphql<{ data?: unknown }>(
    viewerId,
    '26120832744279917',
    'ProfileCometEducationExperienceSaveMutation',
    {
      collectionToken,
      input: {
        concentrations,
        degree_name: params.degreeName ?? '',
        description: params.description ?? '',
        end,
        has_graduated: params.hasGraduated ?? true,
        mutation_surface: 'PROFILE',
        privacy: DEFAULT_PRIVACY,
        school_id: params.schoolId,
        school_name: params.schoolName,
        school_type: params.schoolType ?? 'college',
        start,
        actor_id: viewerId,
        client_mutation_id: nextMutationId(),
      },
      scale: 1,
      sectionToken,
      profileID: viewerId,
      useDefaultActor: false,
    },
  );

  return { raw: raw.data };
}
