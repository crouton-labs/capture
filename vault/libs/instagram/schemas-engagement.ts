import { z } from 'zod';

import { CsrfParam } from './schemas-common';

// ============================================================================
// likePost
// ============================================================================

export const likePostSchema = {
  name: 'likePost',
  description: 'Like a post by its media ID.',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    mediaId: z.string().describe('Numeric media ID of the post to like'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the like was applied successfully'),
  }),
};

export type LikePostInput = z.infer<typeof likePostSchema.input>;
export type LikePostOutput = z.infer<typeof likePostSchema.output>;

// ============================================================================
// unlikePost
// ============================================================================

export const unlikePostSchema = {
  name: 'unlikePost',
  description: 'Remove a like from a post by its media ID.',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    mediaId: z.string().describe('Numeric media ID of the post to unlike'),
  }),
  output: z.object({
    success: z
      .boolean()
      .describe('Whether the unlike was applied successfully'),
  }),
};

export type UnlikePostInput = z.infer<typeof unlikePostSchema.input>;
export type UnlikePostOutput = z.infer<typeof unlikePostSchema.output>;

// ============================================================================
// commentOnPost
// ============================================================================

export const commentOnPostSchema = {
  name: 'commentOnPost',
  description:
    'Create a new comment on a post by its media ID. Returns the new comment ID.',
  notes:
    'To reply to a specific comment, pass replyToCommentId. The reply will appear nested under that comment.',
  input: z.object({
    csrf: CsrfParam,
    mediaId: z.string().describe('Numeric media ID of the post to comment on'),
    text: z.string().describe('Comment text to post'),
    replyToCommentId: z
      .string()
      .optional()
      .describe(
        'ID of the comment to reply to. When set, the new comment is posted as a nested reply to the specified comment rather than a top-level comment.',
      ),
  }),
  output: z.object({
    success: z
      .boolean()
      .describe('Whether the comment was posted successfully'),
    commentId: z.string().describe('ID of the newly created comment'),
  }),
};

export type CommentOnPostInput = z.infer<typeof commentOnPostSchema.input>;
export type CommentOnPostOutput = z.infer<typeof commentOnPostSchema.output>;

// ============================================================================
// deleteComment
// ============================================================================

export const deleteCommentSchema = {
  name: 'deleteComment',
  description: 'Delete a comment from a post by comment ID.',
  notes:
    'Can only delete your own comments. Use commentOnPost to get the commentId.',
  input: z.object({
    csrf: CsrfParam,
    mediaId: z
      .string()
      .describe('Numeric media ID of the post the comment belongs to'),
    commentId: z.string().describe('ID of the comment to delete'),
  }),
  output: z.object({
    success: z
      .boolean()
      .describe('Whether the comment was deleted successfully'),
  }),
};

export type DeleteCommentInput = z.infer<typeof deleteCommentSchema.input>;
export type DeleteCommentOutput = z.infer<typeof deleteCommentSchema.output>;

// ============================================================================
// All Schemas
// ============================================================================

export const allEngagementSchemas = [
  likePostSchema,
  unlikePostSchema,
  commentOnPostSchema,
  deleteCommentSchema,
];
