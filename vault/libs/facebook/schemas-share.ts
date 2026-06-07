import { z } from 'zod';

// ============================================================================
// createShareUrl
// ============================================================================

export const createShareUrlSchema = {
  name: 'createShareUrl',
  description:
    'Create a wrapped facebook.com/share/p/... short link for a post URL.',
  notes: '',
  input: z.object({
    originalUrl: z
      .string()
      .describe(
        'Original Facebook post URL (e.g. https://www.facebook.com/{user}/posts/...).',
      ),
    productType: z
      .enum(['FEED', 'GROUP', 'PAGE', 'PHOTO', 'VIDEO'])
      .optional()
      .default('FEED'),
  }),
  output: z
    .object({
      id: z.string().describe('Numeric id of the wrapper'),
      originalUrl: z.string(),
      wrappedUrl: z
        .string()
        .describe('Short URL like https://www.facebook.com/share/p/{token}/'),
      raw: z.unknown(),
    })
    .passthrough(),
};

// ============================================================================
// getShareLinkPreview
// ============================================================================

export const getShareLinkPreviewSchema = {
  name: 'getShareLinkPreview',
  description:
    'Get XMA preview metadata (title, image, CTA) for a Facebook URL — the same card Messenger shows when pasting a link.',
  notes: '',
  input: z.object({
    url: z.string().describe('Facebook URL to preview'),
  }),
  output: z
    .object({
      title: z.string().nullable(),
      subtitle: z.string().nullable(),
      headerTitle: z.string().nullable(),
      previewUrl: z.string().nullable(),
      faviconUrl: z.string().nullable(),
      headerImageUrl: z.string().nullable(),
      contentType: z
        .string()
        .nullable()
        .describe('xma_content_type, e.g. POST, PHOTO, VIDEO'),
      postId: z.string().nullable(),
      isPublic: z.boolean(),
      raw: z.unknown(),
    })
    .passthrough(),
};

export type CreateShareUrlInput = z.infer<typeof createShareUrlSchema.input>;
export type CreateShareUrlOutput = z.infer<typeof createShareUrlSchema.output>;
export type GetShareLinkPreviewInput = z.infer<
  typeof getShareLinkPreviewSchema.input
>;
export type GetShareLinkPreviewOutput = z.infer<
  typeof getShareLinkPreviewSchema.output
>;
