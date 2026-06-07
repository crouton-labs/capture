import { z } from 'zod';

import { CsrfParam } from './schemas-common';

// ============================================================================
// getPostComments
// ============================================================================

export const getPostCommentsSchema = {
  name: 'getPostComments',
  description:
    'Get paginated comments for a post or reel by its media ID. Returns comment text, author, and engagement counts.',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    mediaId: z.string().describe('Numeric media ID of the post'),
    cursor: z
      .string()
      .optional()
      .describe(
        'Pagination cursor (min_id) from a previous response nextCursor to fetch the next page',
      ),
    count: z
      .number()
      .default(20)
      .describe('Number of comments to return per page. Defaults to 20.'),
  }),
  output: z.object({
    comments: z.array(
      z.object({
        commentId: z.string().describe('Unique comment ID'),
        text: z.string().describe('Comment text'),
        username: z.string().describe('Author username'),
        userId: z.string().describe('Author numeric user ID'),
        profilePicUrl: z.string().describe('Author profile picture URL'),
        likeCount: z.number().describe('Number of likes on this comment'),
        childCommentCount: z
          .number()
          .describe('Number of nested replies on this comment'),
        createdAt: z
          .number()
          .describe('Unix timestamp (seconds) when the comment was created'),
        isVerified: z
          .boolean()
          .describe('Whether the comment author is verified'),
      }),
    ),
    hasMore: z.boolean().describe('Whether there are more comments to fetch'),
    nextCursor: z
      .string()
      .nullable()
      .describe(
        'Cursor to pass as cursor in the next call, or null if no more pages',
      ),
    totalCount: z.number().describe('Number of comments returned in this page'),
  }),
};

export type GetPostCommentsInput = z.infer<typeof getPostCommentsSchema.input>;
export type GetPostCommentsOutput = z.infer<
  typeof getPostCommentsSchema.output
>;

// ============================================================================
// getPostLikers
// ============================================================================

export const getPostLikersSchema = {
  name: 'getPostLikers',
  description:
    'Get the list of users who liked a post or reel by its media ID.',
  notes:
    'Instagram limits liker visibility; private account likers and posts with very high like counts may return an empty or truncated list.',
  input: z.object({
    csrf: CsrfParam,
    mediaId: z.string().describe('Numeric media ID of the post'),
  }),
  output: z.object({
    likers: z.array(
      z.object({
        userId: z.string().describe('Numeric user ID'),
        username: z.string().describe('Username'),
        fullName: z.string().describe('Display name'),
        profilePicUrl: z.string().describe('Profile picture URL'),
        isVerified: z.boolean().describe('Whether the account is verified'),
        isPrivate: z.boolean().describe('Whether the account is private'),
      }),
    ),
    totalCount: z.number().describe('Number of likers returned'),
  }),
};

export type GetPostLikersInput = z.infer<typeof getPostLikersSchema.input>;
export type GetPostLikersOutput = z.infer<typeof getPostLikersSchema.output>;

// ============================================================================
// All Schemas
// ============================================================================

export const allEngagementReadSchemas = [
  getPostCommentsSchema,
  getPostLikersSchema,
];
