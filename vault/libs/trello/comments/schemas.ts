import { z } from 'zod';
import { DscParam, CardIdParam } from '../params';

// ============================================================================
// Entity Schemas
// ============================================================================

export const CommentMemberCreatorSchema = z.object({
  id: z.string().describe('Member ID of the comment author'),
  username: z.string().describe('Username of the comment author'),
  fullName: z.string().describe('Full display name of the comment author'),
  initials: z.string().describe('Initials of the comment author'),
  avatarUrl: z
    .string()
    .nullable()
    .describe('Avatar image URL of the comment author, or null if unset'),
});

export const CommentDataSchema = z.object({
  text: z.string().describe('The comment text content'),
  card: z
    .object({
      id: z.string().describe('Card ID the comment belongs to'),
      name: z.string().describe('Card title at the time of the comment'),
      shortLink: z.string().describe('Card short link identifier'),
    })
    .describe('Card the comment is on'),
  board: z
    .object({
      id: z.string().describe('Board ID'),
      name: z.string().describe('Board name at the time of the comment'),
      shortLink: z.string().describe('Board short link identifier'),
    })
    .describe('Board the comment is on'),
  list: z
    .object({
      id: z.string().describe('List ID the card was in at time of comment'),
      name: z.string().describe('List name at the time of the comment'),
      color: z.string().nullable().describe('List color, or null if unset'),
    })
    .describe('List the card was in at the time of the comment'),
  dateLastEdited: z
    .string()
    .optional()
    .describe(
      'ISO 8601 timestamp of when the comment was last edited. Only present if the comment has been edited after creation.',
    ),
});

export const CommentReactionEmojiSchema = z.object({
  unified: z.string().describe('Unicode unified code point (e.g. "1F44D")'),
  name: z.string().describe('Full emoji name (e.g. "THUMBS UP SIGN")'),
  native: z.string().describe('Native unicode emoji character (e.g. "👍")'),
  shortName: z.string().describe('Primary short name (e.g. "+1")'),
  skinVariation: z
    .string()
    .nullable()
    .describe('Skin tone variation code, or null if none'),
});

export const CommentReactionMemberSchema = z.object({
  id: z.string().describe('Member ID'),
  username: z.string().describe('Username'),
  fullName: z.string().describe('Full display name'),
  avatarUrl: z.string().nullable().describe('Avatar image URL, or null'),
  initials: z.string().describe('Member initials'),
  activityBlocked: z
    .boolean()
    .describe('Whether the member is activity-blocked'),
  nonPublicAvailable: z
    .boolean()
    .describe('Whether non-public profile data is available'),
});

export const CommentReactionSchema = z.object({
  id: z.string().describe('Reaction ID'),
  idMember: z.string().describe('ID of the member who reacted'),
  idModel: z
    .string()
    .describe('ID of the action (comment) this reaction is on'),
  idEmoji: z
    .string()
    .describe('Emoji unified code point identifier (e.g. "1F44D")'),
  member: CommentReactionMemberSchema.describe(
    'Member who added this reaction',
  ),
  emoji: CommentReactionEmojiSchema.describe('Emoji used in this reaction'),
});

export const CommentSchema = z.object({
  id: z.string().describe('Action ID of the comment (used for update/delete)'),
  type: z
    .literal('commentCard')
    .describe('Action type: always "commentCard" for comments'),
  date: z.string().describe('ISO 8601 timestamp when the comment was created'),
  data: CommentDataSchema.describe('Comment data including text and context'),
  memberCreator: CommentMemberCreatorSchema.describe(
    'Member who created this comment',
  ),
  reactions: z
    .array(CommentReactionSchema)
    .optional()
    .describe(
      'Emoji reactions on this comment. Only present when listComments is called with reactions: true.',
    ),
});

// ============================================================================
// Function Schemas
// ============================================================================

export const listCommentsSchema = {
  name: 'listComments',
  description:
    'List all comments on a card, newest first. Auto-paginates via cursor when the card has more than 50 comments.',
  notes: '',
  input: z.object({
    cardId: CardIdParam,
    limit: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .optional()
      .describe(
        'Page size for API requests (1–1000, default 50). The function auto-paginates and always returns all comments; this controls how many are fetched per request, not the total result count.',
      ),
    since: z
      .string()
      .optional()
      .describe(
        'Return only comments created after this point. Accepts an ISO 8601 date string (e.g. "2024-01-01T00:00:00Z") or an action ID. Comments created at or before this value are excluded.',
      ),
    reactions: z
      .boolean()
      .optional()
      .describe(
        'When true, each comment includes a reactions array with all emoji reactions. Default false (reactions field absent). Reactions include emoji data (unified code, native char, shortName) and the reacting member.',
      ),
  }),
  output: z.object({
    comments: z
      .array(CommentSchema)
      .describe('All comments on the card, ordered newest-first'),
  }),
};

export type ListCommentsInput = z.infer<typeof listCommentsSchema.input>;
export type ListCommentsOutput = z.infer<typeof listCommentsSchema.output>;

export const createCommentSchema = {
  name: 'createComment',
  description: 'Add a comment to a card.',
  notes: '',
  input: z.object({
    dsc: DscParam,
    cardId: CardIdParam,
    text: z.string().describe('The comment text to post'),
  }),
  output: z.object({
    comment: CommentSchema.describe('The newly created comment action'),
  }),
};

export type CreateCommentInput = z.infer<typeof createCommentSchema.input>;
export type CreateCommentOutput = z.infer<typeof createCommentSchema.output>;

export const updateCommentSchema = {
  name: 'updateComment',
  description:
    'Edit the text of an existing comment on a card. Only the original author can edit their comment.',
  notes: '',
  input: z.object({
    dsc: DscParam,
    cardId: CardIdParam,
    actionId: z
      .string()
      .describe('Action ID of the comment to edit (from listComments)'),
    text: z.string().describe('New comment text to replace the existing text'),
  }),
  output: z.object({
    comment: CommentSchema.describe('The updated comment action'),
  }),
};

export type UpdateCommentInput = z.infer<typeof updateCommentSchema.input>;
export type UpdateCommentOutput = z.infer<typeof updateCommentSchema.output>;

export const deleteCommentSchema = {
  name: 'deleteComment',
  description:
    'Delete a comment from a card. Only the original author can delete their comment.',
  notes: '',
  input: z.object({
    dsc: DscParam,
    cardId: CardIdParam,
    actionId: z
      .string()
      .describe('Action ID of the comment to delete (from listComments)'),
  }),
  output: z.object({
    success: z
      .boolean()
      .describe('True if the comment was deleted successfully'),
  }),
};

export type DeleteCommentInput = z.infer<typeof deleteCommentSchema.input>;
export type DeleteCommentOutput = z.infer<typeof deleteCommentSchema.output>;

// ============================================================================
// Domain Schema Array
// ============================================================================

export const commentsSchemas = [
  listCommentsSchema,
  createCommentSchema,
  updateCommentSchema,
  deleteCommentSchema,
];
