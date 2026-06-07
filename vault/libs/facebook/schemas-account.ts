import { z } from 'zod';

// ============================================================================
// Shared
// ============================================================================

const RawOutput = z.object({ raw: z.unknown() }).passthrough();

// ============================================================================
// searchLocations
// ============================================================================

const LocationHitSchema = z
  .object({
    id: z
      .string()
      .describe(
        'City page id. Pass to updateCurrentCity / updateHometown as cityId.',
      ),
    title: z.string().describe('Display name, e.g. "Littleton, Colorado"'),
    latitude: z.number().nullable().optional(),
    longitude: z.number().nullable().optional(),
    pageLogoUrl: z.string().nullable().optional(),
  })
  .passthrough();

export const searchLocationsSchema = {
  name: 'searchLocations',
  description:
    "Search Facebook's city/place typeahead by name. Returns city page ids needed by updateCurrentCity and updateHometown.",
  notes: '',
  input: z.object({
    query: z
      .string()
      .describe('Free-text city name, e.g. "Littleton" or "Sao Paulo"'),
    maxResults: z.number().optional().default(10),
  }),
  output: z
    .object({
      results: z.array(LocationHitSchema),
      raw: z.unknown(),
    })
    .passthrough(),
};
export type SearchLocationsInput = z.infer<typeof searchLocationsSchema.input>;
export type SearchLocationsOutput = z.infer<
  typeof searchLocationsSchema.output
>;

// ============================================================================
// searchHubs
// ============================================================================

const HubHitSchema = z
  .object({
    id: z
      .string()
      .describe(
        'Page/hub id. For COLLEGE pass as schoolId to addEducationExperience.',
      ),
    name: z.string(),
    pageLogoUrl: z.string().nullable().optional(),
  })
  .passthrough();

export const searchHubsSchema = {
  name: 'searchHubs',
  description:
    'Search Facebook\'s "hubs" typeahead — pages indexed by category for profile-edit fields. Returns ids needed for addEducationExperience (schoolId from section=COLLEGE) and any future work mutations.',
  notes:
    'Confirmed section values: WORK_HISTORY (employers), WORK_POSITION (job titles), COLLEGE (schools), CONCENTRATION (academic majors). Other values may exist; pass as a string if needed.',
  input: z.object({
    section: z
      .string()
      .describe(
        'Hub category. Confirmed: "WORK_HISTORY", "WORK_POSITION", "COLLEGE", "CONCENTRATION".',
      ),
    query: z.string().describe('Free-text query, e.g. "Stanford"'),
    first: z.number().optional().default(10),
  }),
  output: z
    .object({
      results: z.array(HubHitSchema),
      raw: z.unknown(),
    })
    .passthrough(),
};
export type SearchHubsInput = z.infer<typeof searchHubsSchema.input>;
export type SearchHubsOutput = z.infer<typeof searchHubsSchema.output>;

// ============================================================================
// listProfilePictureCandidates
// ============================================================================

const PhotoTileSchema = z
  .object({
    id: z
      .string()
      .describe(
        'Photo id. Pass as photoId to setProfilePicture or setCoverPhoto.',
      ),
    imageUrl: z.string().nullable().optional(),
    accessibilityCaption: z.string().nullable().optional(),
    width: z.number().nullable().optional(),
    height: z.number().nullable().optional(),
  })
  .passthrough();

const MediaSetSchema = z
  .object({
    id: z.string(),
    title: z
      .string()
      .describe('Album / set title, e.g. "Uploads", "Profile pictures"'),
    mediaSetType: z
      .string()
      .describe('Server-side type, e.g. "PHOTOS_BY", "ALBUM_VIEW"'),
    photos: z.array(PhotoTileSchema),
  })
  .passthrough();

export const listProfilePictureCandidatesSchema = {
  name: 'listProfilePictureCandidates',
  description:
    'Get the photo picker shown in the "Update profile picture" dialog: existing photos that can be set as the viewer\'s profile picture without uploading anything new.',
  notes: '',
  input: z.object({}),
  output: z
    .object({
      mediaSets: z.array(MediaSetSchema),
      raw: z.unknown(),
    })
    .passthrough(),
};
export type ListProfilePictureCandidatesInput = z.infer<
  typeof listProfilePictureCandidatesSchema.input
>;
export type ListProfilePictureCandidatesOutput = z.infer<
  typeof listProfilePictureCandidatesSchema.output
>;

// ============================================================================
// listCoverPhotoCandidates
// ============================================================================

export const listCoverPhotoCandidatesSchema = {
  name: 'listCoverPhotoCandidates',
  description:
    'Get the photo picker shown in the "Update cover photo" dialog: existing photos that can be set as the viewer\'s cover photo.',
  notes: '',
  input: z.object({}),
  output: z
    .object({
      mediaSets: z.array(MediaSetSchema),
      raw: z.unknown(),
    })
    .passthrough(),
};
export type ListCoverPhotoCandidatesInput = z.infer<
  typeof listCoverPhotoCandidatesSchema.input
>;
export type ListCoverPhotoCandidatesOutput = z.infer<
  typeof listCoverPhotoCandidatesSchema.output
>;

// ============================================================================
// updateCurrentCity
// ============================================================================

const CityFieldOutputSchema = z
  .object({
    currentCity: z
      .object({ id: z.string(), name: z.string() })
      .nullable()
      .optional(),
    raw: z.unknown(),
  })
  .passthrough();

export const updateCurrentCitySchema = {
  name: 'updateCurrentCity',
  description:
    'Set the viewer\'s "Current city" on their own profile. Privacy is set to public (EVERYONE).',
  notes:
    'Pass cityId from searchLocations. To clear the field is not supported by this capture.',
  input: z.object({
    cityId: z
      .string()
      .describe(
        'City page id from searchLocations.results[].id, e.g. "111827608833154"',
      ),
  }),
  output: CityFieldOutputSchema,
};
export type UpdateCurrentCityInput = z.infer<
  typeof updateCurrentCitySchema.input
>;
export type UpdateCurrentCityOutput = z.infer<
  typeof updateCurrentCitySchema.output
>;

// ============================================================================
// updateHometown
// ============================================================================

const HometownFieldOutputSchema = z
  .object({
    hometown: z
      .object({ id: z.string(), name: z.string() })
      .nullable()
      .optional(),
    raw: z.unknown(),
  })
  .passthrough();

export const updateHometownSchema = {
  name: 'updateHometown',
  description:
    'Set the viewer\'s "Hometown" on their own profile. Privacy is set to public (EVERYONE).',
  notes: 'Pass cityId from searchLocations.',
  input: z.object({
    cityId: z
      .string()
      .describe('City page id from searchLocations.results[].id'),
  }),
  output: HometownFieldOutputSchema,
};
export type UpdateHometownInput = z.infer<typeof updateHometownSchema.input>;
export type UpdateHometownOutput = z.infer<typeof updateHometownSchema.output>;

// ============================================================================
// updateRelationshipStatus
// ============================================================================

export const updateRelationshipStatusSchema = {
  name: 'updateRelationshipStatus',
  description:
    "Set the viewer's relationship status on their own profile. Privacy is set to public (EVERYONE).",
  notes:
    'Confirmed status values: SINGLE, UNSPECIFIED. Other values likely valid (IN_RELATIONSHIP, ENGAGED, MARRIED, etc.) but not confirmed in source HAR.',
  input: z.object({
    status: z
      .string()
      .describe(
        'Relationship status const. Confirmed: "SINGLE", "UNSPECIFIED". Pass UNSPECIFIED to clear.',
      ),
  }),
  output: RawOutput,
};
export type UpdateRelationshipStatusInput = z.infer<
  typeof updateRelationshipStatusSchema.input
>;
export type UpdateRelationshipStatusOutput = z.infer<
  typeof updateRelationshipStatusSchema.output
>;

// ============================================================================
// setProfilePicture
// ============================================================================

const CropRectSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  })
  .describe('Normalized crop rect 0-1. Omit to use the whole image.');

export const setProfilePictureSchema = {
  name: 'setProfilePicture',
  description:
    "Set the viewer's profile picture to an existing photo from their account (no upload). Use listProfilePictureCandidates to discover available photo ids.",
  notes:
    'Uses profile_pic_method=EXISTING. Uploading a brand-new photo is a separate flow not captured here.',
  input: z.object({
    photoId: z
      .string()
      .describe(
        'Photo id from listProfilePictureCandidates.mediaSets[].photos[].id',
      ),
    scaledCropRect: CropRectSchema.optional(),
    skipCropping: z
      .boolean()
      .optional()
      .default(true)
      .describe('When true (default), skip the crop step.'),
  }),
  output: RawOutput,
};
export type SetProfilePictureInput = z.infer<
  typeof setProfilePictureSchema.input
>;
export type SetProfilePictureOutput = z.infer<
  typeof setProfilePictureSchema.output
>;

// ============================================================================
// setCoverPhoto
// ============================================================================

const FocusSchema = z
  .object({ x: z.number(), y: z.number() })
  .describe('Normalized focus point 0-1; defaults to {x:0.5, y:0.5}.');

export const setCoverPhotoSchema = {
  name: 'setCoverPhoto',
  description:
    "Set the viewer's cover photo to an existing photo from their account. Use listCoverPhotoCandidates to discover photo ids.",
  notes: '',
  input: z.object({
    photoId: z
      .string()
      .describe(
        'Photo id from listCoverPhotoCandidates.mediaSets[].photos[].id',
      ),
    focus: FocusSchema.optional(),
  }),
  output: RawOutput,
};
export type SetCoverPhotoInput = z.infer<typeof setCoverPhotoSchema.input>;
export type SetCoverPhotoOutput = z.infer<typeof setCoverPhotoSchema.output>;

// ============================================================================
// addEducationExperience
// ============================================================================

const ConcentrationSchema = z
  .object({
    id: z
      .string()
      .describe(
        'Concentration page id from searchHubs(section="CONCENTRATION"), or empty string',
      ),
    name: z.string().describe('Concentration name, or empty string'),
  })
  .describe('Major / area of study');

export const addEducationExperienceSchema = {
  name: 'addEducationExperience',
  description:
    "Add a college education entry to the viewer's About → Education. Privacy is set to public (EVERYONE).",
  notes:
    'school_type confirmed: "college". Other school_type values likely exist (e.g. "highSchool") but were not captured.',
  input: z.object({
    schoolId: z
      .string()
      .describe(
        'School page id from searchHubs(section="COLLEGE").results[].id',
      ),
    schoolName: z
      .string()
      .describe(
        'School display name, e.g. "University of Southern California"',
      ),
    schoolType: z
      .string()
      .optional()
      .default('college')
      .describe('Confirmed: "college".'),
    startYear: z.number().optional(),
    endYear: z.number().optional(),
    hasGraduated: z.boolean().optional().default(true),
    degreeName: z.string().optional().default(''),
    description: z.string().optional().default(''),
    concentrations: z
      .array(ConcentrationSchema)
      .optional()
      .default([])
      .describe(
        'Up to 3 concentrations / majors. Use searchHubs(section="CONCENTRATION") to resolve names to ids.',
      ),
  }),
  output: RawOutput,
};
export type AddEducationExperienceInput = z.infer<
  typeof addEducationExperienceSchema.input
>;
export type AddEducationExperienceOutput = z.infer<
  typeof addEducationExperienceSchema.output
>;
