import { z } from 'zod';

const PrivacyEnum = z
  .enum(['EVERYONE', 'FRIENDS', 'ONLY_ME'])
  .describe(
    "Audience for this single post. EVERYONE = Public, FRIENDS = Friends only, ONLY_ME = visible only to the viewer. Set per call; does not change the user's saved default audience.",
  );

// ============================================================================
// createPost
// ============================================================================

export const createPostSchema = {
  name: 'createPost',
  description: "Create a top-level News Feed post on the viewer's timeline.",
  notes:
    'Photos must be uploaded separately first; pass the resulting photo ids via `photoIds`. Locations are looked up via searchPlaces — pass the returned `id` as `locationId`. Audience defaults to FRIENDS; pass `privacy` to override for this post only (does not change the saved default).',
  input: z.object({
    text: z
      .string()
      .describe(
        'Post body text. Pass an empty string when only attaching media.',
      ),
    privacy: PrivacyEnum.optional().default('FRIENDS'),
    photoIds: z
      .array(z.string())
      .optional()
      .default([])
      .describe(
        'Ids of already-uploaded photos to attach. The composer photo upload endpoint that mints these ids is not currently exposed; pass ids sourced from elsewhere (e.g. a previous post or upload).',
      ),
    locationId: z
      .string()
      .nullable()
      .optional()
      .describe(
        'Numeric place id from searchPlaces({ query }).results[].id. When set, the post is tagged with that location.',
      ),
  }),
  output: z
    .object({
      storyId: z
        .string()
        .nullable()
        .describe(
          'Base64 story id of the new post, when the mutation returned one synchronously.',
        ),
      postId: z
        .string()
        .nullable()
        .describe('Numeric legacy post id, when present in the response.'),
      url: z
        .string()
        .nullable()
        .describe(
          'Public permalink to the new post, when present in the response.',
        ),
      raw: z.unknown(),
    })
    .passthrough(),
};

// ============================================================================
// searchPlaces
// ============================================================================

export const searchPlacesSchema = {
  name: 'searchPlaces',
  description:
    'Search Facebook places (businesses, landmarks, parks, restaurants, addresses) for tagging into a post via createPost({ locationId }). Empty `query` returns nearby places ranked by the viewer’s inferred location.',
  notes:
    'Distinct from searchLocations — that one returns Facebook city/region pages used for profile fields (current city, hometown). searchPlaces returns the broader places index used by the post composer check-in picker.',
  input: z.object({
    query: z
      .string()
      .optional()
      .default('')
      .describe('Free-text place name. Empty string returns nearby places.'),
    limit: z.number().optional().default(20),
  }),
  output: z
    .object({
      results: z.array(
        z
          .object({
            id: z
              .string()
              .describe('Numeric place id; pass to createPost as locationId.'),
            name: z.string().nullable(),
            address: z
              .string()
              .nullable()
              .describe(
                'Display address line, e.g. "123 Main St, Springfield".',
              ),
            category: z
              .string()
              .nullable()
              .describe(
                'Top-level category, e.g. "Restaurant", "Park", "Address".',
              ),
            city: z.string().nullable(),
            latitude: z.number().nullable(),
            longitude: z.number().nullable(),
          })
          .passthrough(),
      ),
      raw: z.unknown(),
    })
    .passthrough(),
};

export type CreatePostInput = z.infer<typeof createPostSchema.input>;
export type CreatePostOutput = z.infer<typeof createPostSchema.output>;
export type SearchPlacesInput = z.infer<typeof searchPlacesSchema.input>;
export type SearchPlacesOutput = z.infer<typeof searchPlacesSchema.output>;
