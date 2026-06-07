import { z } from 'zod';

// ============================================================================
// getPhoto
// ============================================================================

const PhotoOutputSchema = z
  .object({
    id: z.string().describe('Numeric photo id (also `nodeID`)'),
    accessibilityCaption: z
      .string()
      .nullable()
      .describe('Auto-generated alt text from Facebook'),
    createdTime: z.number().nullable().describe('Unix-seconds timestamp'),
    imageUrl: z.string().nullable().describe('Primary image URL'),
    imageWidth: z.number().nullable().optional(),
    imageHeight: z.number().nullable().optional(),
    permalinkUrl: z
      .string()
      .nullable()
      .describe('Public URL, e.g. /photo/?fbid={id}&set={mediaset}'),
    ownerId: z.string().nullable().describe('Numeric id of the uploader'),
    ownerName: z.string().nullable(),
    canViewerEdit: z.boolean(),
    isPlayable: z.boolean().describe('True for live photos / animated formats'),
    raw: z.unknown(),
  })
  .passthrough();

export const getPhotoSchema = {
  name: 'getPhoto',
  description:
    'Get a single photo by node id: image URL, alt text, owner, creation time, permalink. Use the same nodeID with getPhotoTags for tagged-people info.',
  notes:
    'nodeID is the numeric photo id (e.g. "173510767913517"), found in profile feed posts (post_id of an attachment) and in listProfilePhotos tiles.',
  input: z.object({
    nodeID: z.string().describe('Numeric photo id'),
  }),
  output: PhotoOutputSchema,
};
export type GetPhotoInput = z.infer<typeof getPhotoSchema.input>;
export type GetPhotoOutput = z.infer<typeof getPhotoSchema.output>;

// ============================================================================
// getPhotoTags
// ============================================================================

const PhotoTagsOutputSchema = z
  .object({
    nodeID: z.string(),
    tags: z
      .array(
        z
          .object({
            id: z.string().nullable().optional(),
            name: z.string().nullable().optional(),
            url: z.string().nullable().optional(),
            x: z.number().nullable().optional().describe('Tag x position 0-1'),
            y: z.number().nullable().optional().describe('Tag y position 0-1'),
          })
          .passthrough(),
      )
      .describe('People / pages tagged in the photo'),
    raw: z.unknown(),
  })
  .passthrough();

export const getPhotoTagsSchema = {
  name: 'getPhotoTags',
  description:
    'Get the list of people / pages tagged in a photo, including their position on the image.',
  notes: '',
  input: z.object({
    nodeID: z.string().describe('Numeric photo id'),
  }),
  output: PhotoTagsOutputSchema,
};
export type GetPhotoTagsInput = z.infer<typeof getPhotoTagsSchema.input>;
export type GetPhotoTagsOutput = z.infer<typeof getPhotoTagsSchema.output>;
