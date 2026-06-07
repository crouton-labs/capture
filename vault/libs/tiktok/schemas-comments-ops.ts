import { z } from 'zod';

// ============================================================================
// Comment Ops Schemas
// ============================================================================

export const deleteCommentsSchema = {
  name: 'deleteComments',
  description: 'Bulk delete multiple comments by ID from your TikTok posts.',
  notes:
    'Deletes each comment sequentially (no batch endpoint available). Returns success/failure per comment ID. Can only delete comments on your own posts.',
  input: z.object({
    csrfToken: z.string().describe('CSRF token from getContext()'),
    deviceId: z.string().describe('Device ID from getContext()'),
    region: z.string().describe('Region from getContext()'),
    language: z.string().describe('Language from getContext()'),
    commentIds: z
      .array(z.string())
      .min(1)
      .describe('Array of comment IDs to delete (from listComments)'),
  }),
  output: z.object({
    results: z
      .array(
        z.object({
          commentId: z.string().describe('Comment ID'),
          success: z
            .boolean()
            .describe('Whether this comment was successfully deleted'),
          error: z
            .string()
            .optional()
            .describe('Error message if deletion failed'),
        }),
      )
      .describe('Per-comment deletion results'),
    successCount: z
      .number()
      .describe('Number of comments successfully deleted'),
    failureCount: z
      .number()
      .describe('Number of comments that failed to delete'),
  }),
};

export type DeleteCommentsInput = z.infer<typeof deleteCommentsSchema.input>;
export type DeleteCommentsOutput = z.infer<typeof deleteCommentsSchema.output>;

export const pinCommentSchema = {
  name: 'pinComment',
  description: "Pin a comment to the top of a post's comment section.",
  notes:
    'Comment pinning is not available in TikTok Studio web. This feature is only accessible via the TikTok mobile app. This function will throw an error.',
  input: z.object({
    csrfToken: z.string().describe('CSRF token from getContext()'),
    deviceId: z.string().describe('Device ID from getContext()'),
    region: z.string().describe('Region from getContext()'),
    language: z.string().describe('Language from getContext()'),
    itemId: z.string().describe('Post/video ID that the comment belongs to'),
    commentId: z.string().describe('Comment ID to pin (from listComments)'),
  }),
  output: z.object({
    success: z
      .boolean()
      .describe('Whether the comment was pinned successfully'),
  }),
};

export type PinCommentInput = z.infer<typeof pinCommentSchema.input>;
export type PinCommentOutput = z.infer<typeof pinCommentSchema.output>;

export const unpinCommentSchema = {
  name: 'unpinComment',
  description:
    "Unpin a previously pinned comment from the top of a post's comment section.",
  notes:
    'Comment unpinning is not available in TikTok Studio web. This feature is only accessible via the TikTok mobile app. This function will throw an error.',
  input: z.object({
    csrfToken: z.string().describe('CSRF token from getContext()'),
    deviceId: z.string().describe('Device ID from getContext()'),
    region: z.string().describe('Region from getContext()'),
    language: z.string().describe('Language from getContext()'),
    itemId: z.string().describe('Post/video ID that the comment belongs to'),
    commentId: z.string().describe('Comment ID to unpin'),
  }),
  output: z.object({
    success: z
      .boolean()
      .describe('Whether the comment was unpinned successfully'),
  }),
};

export type UnpinCommentInput = z.infer<typeof unpinCommentSchema.input>;
export type UnpinCommentOutput = z.infer<typeof unpinCommentSchema.output>;
