import { z } from 'zod';

// ============================================================================
// createPhotoStory
// ============================================================================

export const createPhotoStorySchema = {
  name: 'createPhotoStory',
  description:
    "Post a photo to the viewer's Story (visible to the viewer's Stories audience for 24 hours).",
  notes:
    "Audience is the viewer's default Stories self-audience — whatever was last selected on facebook.com/stories/create. Use a vertical image (e.g. 1080×1920) for best framing.",
  input: z.object({
    dataUrl: z
      .string()
      .describe(
        'Image as a `data:image/jpeg;base64,...` or `data:image/png;base64,...` URL.',
      ),
  }),
  output: z
    .object({
      storyId: z
        .string()
        .nullable()
        .describe(
          'Newly created story node id, when the mutation returned one.',
        ),
      photoId: z
        .string()
        .describe('Id of the uploaded photo attached to the story.'),
      raw: z.unknown(),
    })
    .passthrough(),
};

export type CreatePhotoStoryInput = z.infer<
  typeof createPhotoStorySchema.input
>;
export type CreatePhotoStoryOutput = z.infer<
  typeof createPhotoStorySchema.output
>;
