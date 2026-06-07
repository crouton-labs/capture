import { z } from 'zod';

import { CsrfParam } from './schemas-common';

// ============================================================================
// createPost
// ============================================================================

export const createPostSchema = {
  name: 'createPost',
  description:
    '[EXPERIMENTAL — image upload is not yet verified working] Upload a JPEG image and publish it as a new Instagram post. Returns the post ID, shortcode, and URL.',
  notes:
    'EXPERIMENTAL / UNVERIFIED: as of Jun 2026 the upload step (POST /rupload_igphoto/) returns HTTP 403 {"message":"login_required"}. The likely cause is a missing x-ig-www-claim header — the rupload endpoint requires it, but createPost does not send one, and the value is NOT a cookie (getContext().claimToken reads x-ig-www-claim from cookies and returns "0"). Fixing this needs a HAR capture of a real instagram.com web post to confirm the exact upload auth headers. Until verified, expect createPost to fail. imageBase64 must be a valid JPEG encoded as base64. The configure step requires JSON content-type; form-encoded will fail.',
  input: z.object({
    csrf: CsrfParam,
    imageBase64: z
      .string()
      .describe('Base64-encoded JPEG image bytes to upload'),
    caption: z.string().describe('Caption text for the post'),
    disableComments: z
      .boolean()
      .optional()
      .describe('Prevent others from commenting. Default: false'),
    hideLikesAndViewCounts: z
      .boolean()
      .optional()
      .describe('Hide like and view counts from viewers. Default: false'),
    locationId: z
      .string()
      .optional()
      .describe('Numeric location ID to tag on the post'),
    altText: z
      .string()
      .optional()
      .describe('Accessibility alt text for the image'),
  }),
  output: z.object({
    postId: z.string().describe('Numeric media ID of the newly created post'),
    shortcode: z
      .string()
      .describe('URL-safe shortcode, usable in instagram.com/p/{shortcode}/'),
    url: z.string().describe('Full URL to the published post'),
  }),
};

export type CreatePostInput = z.infer<typeof createPostSchema.input>;
export type CreatePostOutput = z.infer<typeof createPostSchema.output>;

// ============================================================================
// deletePost
// ============================================================================

export const deletePostSchema = {
  name: 'deletePost',
  description: 'Permanently delete a post by its media ID.',
  notes: 'Can only delete your own posts.',
  input: z.object({
    csrf: CsrfParam,
    mediaId: z.string().describe('Numeric media ID of the post to delete'),
    mediaType: z
      .enum(['PHOTO', 'VIDEO', 'CAROUSEL'])
      .optional()
      .describe('Media type of the post. Default: PHOTO'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the post was deleted successfully'),
  }),
};

export type DeletePostInput = z.infer<typeof deletePostSchema.input>;
export type DeletePostOutput = z.infer<typeof deletePostSchema.output>;

// ============================================================================
// All Schemas
// ============================================================================

export const allPublishSchemas = [createPostSchema, deletePostSchema];
