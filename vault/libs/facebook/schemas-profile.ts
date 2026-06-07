import { z } from 'zod';

// ============================================================================
// Shared profile primitives
// ============================================================================

const CoverPhotoSchema = z
  .object({
    photo: z
      .object({
        id: z.string(),
        image: z
          .object({
            uri: z.string(),
            width: z.number().optional(),
            height: z.number().optional(),
          })
          .passthrough(),
      })
      .passthrough()
      .nullable()
      .optional(),
    url: z.string().nullable().optional(),
    focus: z.object({ x: z.number(), y: z.number() }).partial().optional(),
  })
  .passthrough();

const ProfileSectionSchema = z
  .object({
    id: z
      .string()
      .describe(
        'Section token. Base64 of `app_section:{userID}:{sectionNumber}`. Pass to getProfileTopSection.',
      ),
    name: z
      .string()
      .describe('Display label, e.g. "About", "Friends", "Photos"'),
    tab_key: z
      .string()
      .describe(
        'Canonical tab slug, e.g. "about", "friends", "photos". Use as input to getProfileAbout/listProfileSection.',
      ),
    section_type: z
      .string()
      .describe('Server-side type, e.g. "ABOUT", "FRIENDS", "PHOTOS", "MAP"'),
    url: z
      .string()
      .describe('Public URL for this section, e.g. /{vanity}/about'),
    has_new_content: z.boolean().optional(),
    displayable_count: z.number().nullable().optional(),
    all_collections: z
      .object({
        nodes: z
          .array(
            z
              .object({
                id: z
                  .string()
                  .describe(
                    'Collection token. Base64 of `app_collection:pfbid...`. Pass to getProfileCollection / listProfileFriends.',
                  ),
                tab_key: z
                  .string()
                  .describe(
                    'Collection slug, e.g. "about_overview", "friends_all", "photos_of"',
                  ),
              })
              .passthrough(),
          )
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

// ============================================================================
// getProfileHovercard (existing — keep compatible)
// ============================================================================

const ProfileOutput = z.object({ data: z.unknown() }).passthrough();
export type ProfileResponse = z.infer<typeof ProfileOutput>;

export const getProfileHovercardSchema = {
  name: 'getProfileHovercard',
  description:
    "Get a person's hovercard preview: name, profile photo, mutual-friend count, friendship state, work/education snippets, and the action-bar buttons (Add Friend / Message / Follow).",
  notes:
    'Pair with search-result entries: each search hit returns an entityID; this enriches the hit without navigating to the full profile.',
  input: z.object({
    entityID: z
      .string()
      .describe(
        "Numeric Facebook user/page id (e.g. '100000479715281'). Found on search results, friend lists, and post authors.",
      ),
  }),
  output: ProfileOutput,
};
export type GetProfileHovercardInput = z.infer<
  typeof getProfileHovercardSchema.input
>;

// ============================================================================
// getProfileHeader
// ============================================================================

export const ProfileHeaderOutputSchema = z
  .object({
    userID: z.string().describe('Numeric Facebook user id'),
    name: z.string().describe('Display name'),
    alternateName: z
      .string()
      .describe(
        'Alternate / maiden name shown under the main name (may be empty)',
      ),
    profileUrl: z
      .string()
      .describe(
        'Canonical profile URL, e.g. https://www.facebook.com/{vanity}',
      ),
    userVanity: z
      .string()
      .describe(
        'Vanity slug parsed from profileUrl (e.g. "MichaelHanchao"). Empty for users without a vanity.',
      ),
    gender: z.string().nullable().describe('User-stated gender, may be null'),
    isViewerFriend: z.boolean(),
    isVerified: z.boolean().describe('Verified blue-check'),
    isMemorialized: z.boolean(),
    profilePicLargeUrl: z.string().nullable(),
    profilePicMediumUrl: z.string().nullable(),
    profilePicSmallUrl: z.string().nullable(),
    coverPhoto: CoverPhotoSchema.nullable(),
    sections: z
      .array(ProfileSectionSchema)
      .describe(
        'Top-level profile tabs (About, Friends, Photos, etc.) with their section / collection tokens.',
      ),
    raw: z
      .unknown()
      .describe('Full raw GraphQL response.data for advanced access'),
  })
  .passthrough();
export type ProfileHeaderOutput = z.infer<typeof ProfileHeaderOutputSchema>;

export const getProfileHeaderSchema = {
  name: 'getProfileHeader',
  description:
    "Get a profile's header: name, profile photo, cover photo, vanity slug, friendship status, verification badge, and the index of profile tabs (About, Friends, Photos, etc.) with their section/collection tokens for use in getProfileAbout, listProfileSection, getProfileCollection.",
  notes:
    'Numeric userID only. Sources: listFriendsContent, listContacts, searchUsersTypeahead, or getProfileHovercard responses.',
  input: z.object({
    userID: z.string().describe('Numeric Facebook user id'),
  }),
  output: ProfileHeaderOutputSchema,
};
export type GetProfileHeaderInput = z.infer<
  typeof getProfileHeaderSchema.input
>;

// ============================================================================
// getProfileTopSection
// ============================================================================

const TopSectionOutputSchema = z
  .object({
    id: z.string().describe('Section token (echoes input)'),
    name: z.string(),
    sectionType: z.string(),
    url: z.string(),
    raw: z.unknown(),
  })
  .passthrough();

export const getProfileTopSectionSchema = {
  name: 'getProfileTopSection',
  description:
    "Get the renderer for a single profile section (e.g. About, Photos, Check-ins). Returns the section's display metadata; for the actual feed content use listProfileSection.",
  notes:
    'tabKey takes precedence: pass the slug from getProfileHeader.sections[].tab_key. The function auto-resolves the section token via /ajax/route-definition/.',
  input: z.object({
    userID: z.string().describe('Numeric Facebook user id'),
    tabKey: z
      .string()
      .describe(
        'Section slug from getProfileHeader, e.g. "about", "friends", "photos", "videos", "map", "reels".',
      ),
  }),
  output: TopSectionOutputSchema,
};
export type GetProfileTopSectionInput = z.infer<
  typeof getProfileTopSectionSchema.input
>;

// ============================================================================
// getProfileAbout
// ============================================================================

const AboutEntityRefSchema = z
  .object({
    id: z.string().describe('Numeric Page/User id'),
    name: z.string().describe('Display name'),
    url: z.string().nullable().describe('Canonical URL for the entity'),
    typename: z
      .string()
      .describe(
        'GraphQL __typename: "Page" for cities/employers/schools, "User" for tagged people',
      ),
  })
  .passthrough();

const AboutFieldSchema = z
  .object({
    fieldType: z
      .string()
      .describe(
        'Field discriminator. Common values: "current_city", "hometown", "work_history", "education", "languages", "religion", "political_view", "nickname", "relationship", "family", "contact_basic_info", "bio", "details_about". null_state placeholders are filtered out.',
      ),
    text: z
      .string()
      .describe(
        'Rendered display text, e.g. "Lives in Vienna, Virginia" or "Studied at Uia Grimstad"',
      ),
    entities: z
      .array(AboutEntityRefSchema)
      .describe(
        'Linked entities referenced in `text` (cities → Page, employers → Page, schools → Page, tagged people → User).',
      ),
    url: z
      .string()
      .nullable()
      .describe('Outbound link if the field carries one (e.g. websites)'),
  })
  .passthrough();

const AboutSectionSchema = z
  .object({
    sectionType: z
      .string()
      .describe(
        'Subsection within About. Common values: "overview", "work", "education", "places", "relationship", "family_members", "contact_basic_info", "details", "life_events".',
      ),
    fields: z.array(AboutFieldSchema),
  })
  .passthrough();

const AboutOutputSchema = z
  .object({
    userID: z.string(),
    currentCity: z
      .object({
        name: z.string(),
        pageId: z
          .string()
          .nullable()
          .describe(
            'Numeric Page id of the city, when Facebook has linked one',
          ),
      })
      .nullable()
      .describe(
        'Convenience extract of the current_city field from the overview section.',
      ),
    hometown: z
      .object({
        name: z.string(),
        pageId: z.string().nullable(),
      })
      .nullable()
      .describe(
        'Convenience extract of the hometown field from the overview section.',
      ),
    sections: z
      .array(AboutSectionSchema)
      .describe(
        'All About subsections with their fields. Walk this for work, education, contact info, life events, and any field types not surfaced as a top-level convenience getter.',
      ),
    raw: z
      .unknown()
      .optional()
      .describe(
        'Full raw GraphQL response.data — escape hatch for advanced traversal',
      ),
  })
  .passthrough();
export type AboutOutput = z.infer<typeof AboutOutputSchema>;

export const getProfileAboutSchema = {
  name: 'getProfileAbout',
  description:
    "Get the contents of a profile's About section as structured fields: current city, hometown, work history, education, places lived, contact info, family, life events. The exact subset depends on what the user has made public.",
  notes:
    'Returns flattened sections/fields with `fieldType` discriminators. The library navigates the SPA route /{vanity}/about internally to mint tokens; vanity is auto-discovered. Empty/null_state placeholders are stripped, so an empty `sections` array means the profile has no public About data.',
  input: z.object({
    userID: z.string().describe('Numeric Facebook user id'),
  }),
  output: AboutOutputSchema,
};
export type GetProfileAboutInput = z.infer<typeof getProfileAboutSchema.input>;

// ============================================================================
// listProfilePosts
// ============================================================================

const TimelineFeedOutputSchema = z
  .object({
    edges: z
      .array(
        z
          .object({
            node: z
              .object({
                id: z.string().describe('Story (feed-unit) id'),
                post_id: z.string().nullable().optional(),
                permalink_url: z.string().nullable().optional(),
                cache_id: z.string().optional(),
                actors: z
                  .array(
                    z
                      .record(z.string(), z.unknown())
                      .describe(
                        'Author entity, has {id, name, profile_picture, url, __typename}',
                      ),
                  )
                  .optional(),
                attachments: z
                  .array(
                    z
                      .record(z.string(), z.unknown())
                      .describe(
                        'Attachments: photos, videos, links, shared posts',
                      ),
                  )
                  .optional(),
                feedback: z
                  .record(z.string(), z.unknown())
                  .describe(
                    'Reactions and comments. Counts at .reactors.count, .comments.total_count.',
                  )
                  .optional(),
                creation_time: z.number().optional(),
                comet_sections: z
                  .record(z.string(), z.unknown())
                  .describe(
                    'Rendered post body. Text usually under .content.story.message.text.',
                  )
                  .optional(),
              })
              .passthrough(),
          })
          .passthrough(),
      )
      .describe('Posts in the requested page'),
    pageInfo: z
      .object({
        hasNextPage: z.boolean(),
        endCursor: z.string().nullable(),
      })
      .describe('Pass endCursor as `cursor` on the next call to paginate.'),
    raw: z.unknown(),
  })
  .passthrough();

export const listProfilePostsSchema = {
  name: 'listProfilePosts',
  description:
    "Get a profile's timeline posts in reverse chronological order. Returns the user's own posts plus tagged posts they've shared, with reactions and comment counts.",
  notes:
    'Pinned post is omitted. Cursor pagination via pageInfo.endCursor; pass it as `cursor` on the next call to fetch the next batch. The function switches doc_id internally between initial and paginated calls.',
  input: z.object({
    userID: z.string().describe('Numeric Facebook user id'),
    count: z
      .number()
      .optional()
      .default(3)
      .describe('Posts per page (initial calls fetch 1-3, pagination 3+)'),
    cursor: z
      .string()
      .nullable()
      .optional()
      .describe(
        'Opaque cursor from a previous response. Omit for the first page.',
      ),
  }),
  output: TimelineFeedOutputSchema,
};
export type ListProfilePostsInput = z.infer<
  typeof listProfilePostsSchema.input
>;

// ============================================================================
// getProfileTimelineListView
// ============================================================================

const ProfileTileSchema = z
  .object({
    tileSectionType: z
      .string()
      .describe(
        'Tile section discriminator: "INTRO", "PHOTOS", "FRIENDS", "REELS", "VIDEOS", "GROUPS", "PAGES", "MUTUAL_FRIENDS", etc.',
      ),
    title: z.string().nullable(),
    subtitle: z.string().nullable(),
    url: z
      .string()
      .nullable()
      .describe('See-all link for this tile, e.g. /MichaelHanchao/photos'),
    isPinned: z
      .boolean()
      .describe('Whether this tile was pinned by the profile owner'),
    isDirectoryProtile: z.boolean(),
    actionLink: z
      .object({
        title: z.string().nullable(),
        url: z.string().nullable(),
        typename: z.string(),
      })
      .nullable()
      .describe('"See all" link metadata if present'),
  })
  .passthrough();

const TimelineListViewOutputSchema = z
  .object({
    userID: z.string(),
    shouldHideVisitorContent: z.boolean(),
    shouldHidePrivacyFilters: z.boolean(),
    hasProfessionalDashboard: z.boolean(),
    hasComposer: z
      .boolean()
      .describe(
        'True when the viewer can post on this timeline (own profile or page they manage)',
      ),
    hasHighlightUnits: z.boolean(),
    hasPendingReviewUnit: z
      .boolean()
      .describe(
        'True when the profile_info_review_unit is present (viewer has pending tagged content)',
      ),
    delegatePageId: z
      .string()
      .nullable()
      .describe(
        'Numeric id of the linked Page when this profile delegates to one',
      ),
    tiles: z
      .array(ProfileTileSchema)
      .describe(
        'Profile tile sections shown on the timeline. Use these as a hint for which getProfileCollection / listProfileSection calls to make.',
      ),
    pageInfo: z
      .object({
        hasNextPage: z.boolean(),
        endCursor: z.string().nullable(),
      })
      .nullable(),
    raw: z.unknown().optional(),
  })
  .passthrough();
export type TimelineListViewOutput = z.infer<
  typeof TimelineListViewOutputSchema
>;

export const getProfileTimelineListViewSchema = {
  name: 'getProfileTimelineListView',
  description:
    'Get the timeline rail metadata for a profile: visibility flags, pinned/featured tiles, and which profile sections (Intro, Photos, Friends, Reels, etc.) are publicly displayed. Use listProfilePosts for the actual posts.',
  notes:
    'Tiles tell you which sections have public content without enumerating them. Tile types like INTRO, PHOTOS, FRIENDS map to the corresponding sections in getProfileHeader.',
  input: z.object({
    userID: z.string().describe('Numeric Facebook user id'),
  }),
  output: TimelineListViewOutputSchema,
};
export type GetProfileTimelineListViewInput = z.infer<
  typeof getProfileTimelineListViewSchema.input
>;

// ============================================================================
// listProfilePhotos
// ============================================================================

const ProfilePhotosOutputSchema = z
  .object({
    tiles: z
      .array(
        z
          .object({
            id: z.string().describe('Photo id (also usable with getPhoto)'),
            permalink: z.string().nullable().optional(),
            image: z
              .object({ uri: z.string() })
              .passthrough()
              .nullable()
              .optional(),
          })
          .passthrough(),
      )
      .describe('Photo tiles in the requested page'),
    pageInfo: z
      .object({
        hasNextPage: z.boolean(),
        endCursor: z.string().nullable(),
      })
      .optional(),
    raw: z.unknown(),
  })
  .passthrough();

export const listProfilePhotosSchema = {
  name: 'listProfilePhotos',
  description:
    "Get a tiled view of photos uploaded by the profile (photos they appear in are a separate collection — use getProfileCollection with collectionName='photos_of').",
  notes:
    'First page uses cursor="photos" implicitly. Subsequent pages pass pageInfo.endCursor as cursor.',
  input: z.object({
    userID: z.string().describe('Numeric Facebook user id'),
    count: z.number().optional().default(8),
    cursor: z.string().nullable().optional(),
  }),
  output: ProfilePhotosOutputSchema,
};
export type ListProfilePhotosInput = z.infer<
  typeof listProfilePhotosSchema.input
>;

// ============================================================================
// listProfileSection
// ============================================================================

const SectionCollectionRefSchema = z
  .object({
    id: z
      .string()
      .describe('Collection token (base64 of `app_collection:pfbid...`)'),
    name: z
      .string()
      .nullable()
      .describe('Display name, e.g. "Overview", "Friends"'),
    tabKey: z
      .string()
      .nullable()
      .describe('Slug for getProfileCollection, e.g. "about_overview"'),
  })
  .passthrough();

const SectionFeedOutputSchema = z
  .object({
    sections: z
      .array(
        z
          .object({
            id: z
              .string()
              .describe(
                'Section token (base64 of `app_section:{userID}:{sectionNumber}`)',
              ),
            name: z
              .string()
              .describe('Display label, e.g. "About", "Friends", "Photos"'),
            sectionType: z
              .string()
              .describe(
                'Server-side section type, e.g. "ABOUT", "FRIENDS", "PHOTOS", "MAP"',
              ),
            subtitle: z.string().nullable(),
            url: z.string().describe('Public URL for this section'),
            navCollections: z
              .array(SectionCollectionRefSchema)
              .describe(
                'Collections shown in the section nav (subset of allCollections)',
              ),
            allCollections: z
              .array(SectionCollectionRefSchema)
              .describe(
                'All collections in this section. Pass tab_key as collectionKey to getProfileCollection.',
              ),
            cursor: z.string().nullable().optional(),
          })
          .passthrough(),
      )
      .describe('Profile sections returned in this page'),
    pageInfo: z
      .object({
        hasNextPage: z.boolean(),
        endCursor: z.string().nullable(),
      })
      .nullable(),
    raw: z.unknown().optional(),
  })
  .passthrough();
export type SectionFeedOutput = z.infer<typeof SectionFeedOutputSchema>;

export const listProfileSectionSchema = {
  name: 'listProfileSection',
  description:
    "Get the feed of items in a profile's section by tab key. About → work/education entries; Photos → photo tiles; Friends → friend cards; Videos → video tiles. For nested collections (e.g. about_overview within About), use getProfileCollection.",
  notes:
    'Function auto-navigates the SPA route /{vanity}/{tabKey} to mint section tokens. Cursor pagination.',
  input: z.object({
    userID: z.string().describe('Numeric Facebook user id'),
    tabKey: z
      .string()
      .describe(
        'Section slug from getProfileHeader.sections[].tab_key, e.g. "about", "photos", "videos", "map".',
      ),
    count: z.number().optional().default(5),
    cursor: z.string().nullable().optional(),
  }),
  output: SectionFeedOutputSchema,
};
export type ListProfileSectionInput = z.infer<
  typeof listProfileSectionSchema.input
>;

// ============================================================================
// getProfileCollection
// ============================================================================

const CollectionOutputSchema = z
  .object({
    id: z
      .string()
      .describe('Collection token (matches the resolved server token)'),
    name: z
      .string()
      .nullable()
      .describe(
        'Display name of the collection, e.g. "Current city", "Friends", "Work and education"',
      ),
    url: z.string().nullable().describe('Public URL for this collection'),
    rendererType: z
      .string()
      .describe(
        'GraphQL __typename of the collection renderer, e.g. "TimelineAppCollectionListRenderer", "TimelineAppCollectionAboutOverviewRenderer", "TimelineAppCollectionFriendsListRenderer".',
      ),
    nullStateMessage: z
      .string()
      .nullable()
      .describe(
        'Message shown when the collection is empty, e.g. "No workplaces to show"',
      ),
    items: z
      .array(z.record(z.string(), z.unknown()))
      .describe(
        'Collection entries. Shape varies by collection: friends → {id, name, profile_picture, url}; places → {city, location, time}; work_and_education → {employer/school, position, start, end}; photos_of → {id, image, owner}. Use rendererType to disambiguate.',
      ),
    pageInfo: z
      .object({
        hasNextPage: z.boolean(),
        endCursor: z.string().nullable(),
      })
      .nullable()
      .describe('Cursor for paginating through items if applicable'),
    raw: z
      .unknown()
      .optional()
      .describe('Raw GraphQL response.data for advanced traversal'),
  })
  .passthrough();
export type CollectionOutput = z.infer<typeof CollectionOutputSchema>;

export const getProfileCollectionSchema = {
  name: 'getProfileCollection',
  description:
    "Get a profile sub-collection's contents by collection key (e.g. about_overview, about_work_and_education, about_places, friends_all, photos_of). Returns the static fields of the collection; lists within it are paginated separately (e.g. listProfileFriends for friends_all).",
  notes:
    'Pass the slug (tab_key), NOT the base64 id token from the same node. The function re-mints the collectionToken internally by walking the SPA route /{vanity}/{tab}/{rest}.',
  input: z.object({
    userID: z.string().describe('Numeric Facebook user id'),
    collectionKey: z
      .string()
      .describe(
        'Collection SLUG from getProfileHeader.sections[].all_collections.nodes[].tab_key — e.g. "about_overview", "about_work_and_education", "friends_all", "photos_of". Do not pass the sibling `id` field (that is the base64 token).',
      ),
  }),
  output: CollectionOutputSchema,
};
export type GetProfileCollectionInput = z.infer<
  typeof getProfileCollectionSchema.input
>;

// ============================================================================
// listProfileFriends
// ============================================================================

const FriendsListOutputSchema = z
  .object({
    friends: z
      .array(
        z
          .object({
            id: z.string().describe('Numeric user id of the friend'),
            name: z.string().nullable().optional(),
            profilePicUrl: z.string().nullable().optional(),
            url: z.string().nullable().optional(),
            mutualFriendsText: z
              .string()
              .nullable()
              .optional()
              .describe('e.g. "12 mutual friends" if shown'),
          })
          .passthrough(),
      )
      .describe('Friends in the requested page'),
    pageInfo: z
      .object({
        hasNextPage: z.boolean(),
        endCursor: z.string().nullable(),
      })
      .optional(),
    raw: z.unknown(),
  })
  .passthrough();

export const listProfileFriendsSchema = {
  name: 'listProfileFriends',
  description:
    "Get the list of public friends shown on a profile's Friends tab. Excludes friends the profile owner has hidden. Each entry surfaces the friend's user id for further calls (getProfileHeader, getProfileHovercard).",
  notes:
    'Function navigates /{vanity}/friends to mint the collection token. Pass `search` to filter the list server-side by name.',
  input: z.object({
    userID: z
      .string()
      .describe('Numeric Facebook user id whose friends to list'),
    count: z.number().optional().default(8),
    cursor: z.string().nullable().optional(),
    search: z
      .string()
      .nullable()
      .optional()
      .describe('Server-side name filter; null/omitted returns all'),
  }),
  output: FriendsListOutputSchema,
};
export type ListProfileFriendsInput = z.infer<
  typeof listProfileFriendsSchema.input
>;
