import { z } from 'zod';

const CommentsRawOutput = z.object({ data: z.unknown() }).passthrough();

const ReactionEnum = z
  .enum(['LIKE', 'LOVE', 'CARE', 'HAHA', 'WOW', 'SAD', 'ANGRY'])
  .describe(
    'Named reaction. Mapped internally to the numeric reaction id Facebook expects.',
  );

const TopReactionSchema = z
  .object({
    id: z.string().describe('Numeric reaction id'),
    name: z.string().describe('Localized reaction name (e.g. Like, Haha)'),
    count: z.number(),
    i18nCount: z.string().describe('Localized count string (e.g. "31K")'),
    visibleInBlingBar: z.boolean(),
  })
  .passthrough();

// ============================================================================
// createComment
// ============================================================================

export const createCommentSchema = {
  name: 'createComment',
  description:
    'Post a comment on a post, photo, video, or other feedback target.',
  notes:
    'feedbackId is the base64 `feedback:{...}` token attached to the target (e.g. response.feedback.id). For mentions inside text, populate `messageRanges` with entity ids from getMentionSuggestions.',
  input: z.object({
    feedbackId: z
      .string()
      .describe(
        'Base64 feedback id of the target (post/photo/video). Found at `feedback.id` in any post/photo response.',
      ),
    text: z
      .string()
      .describe(
        'Comment body text. May be empty if posting a sticker/attachment (not yet supported).',
      ),
    messageRanges: z
      .array(
        z.object({
          offset: z.number(),
          length: z.number(),
          entity: z
            .object({ id: z.string() })
            .describe('Mentioned entity (user/page/group)'),
        }),
      )
      .optional()
      .default([])
      .describe(
        'Inline mention ranges. Each range covers a substring of `text` and references a profile id.',
      ),
    feedbackSource: z
      .enum(['OBJECT', 'NEWS_FEED', 'GROUPS', 'PROFILE', 'PHOTO', 'VIDEO'])
      .optional()
      .default('OBJECT'),
  }),
  output: z
    .object({
      commentId: z
        .string()
        .describe('Base64 id of the newly created comment node'),
      cursor: z
        .string()
        .nullable()
        .describe('Pagination cursor for the new comment'),
      feedbackId: z.string(),
      totalComments: z.number().nullable(),
      authorId: z.string().nullable(),
      authorName: z.string().nullable(),
      raw: z.unknown(),
    })
    .passthrough(),
};

// ============================================================================
// reactToFeedback
// ============================================================================

export const reactToFeedbackSchema = {
  name: 'reactToFeedback',
  description:
    "Set or change the viewer's reaction (Like/Love/Care/Haha/Wow/Sad/Angry) on a post, comment, photo, or other feedback target.",
  notes:
    'Pass the same `reaction` again to keep it; the Comet UFI mutation is idempotent. To clear, currently no separate "unreact" endpoint is exposed in the HAR — calling with the same reaction toggles off in some surfaces but pass-through reactor lists are the source of truth.',
  input: z.object({
    feedbackId: z
      .string()
      .describe(
        'Base64 feedback id of the target. Same value used by createComment.',
      ),
    reaction: ReactionEnum.optional().default('LIKE'),
    feedbackSource: z
      .enum(['OBJECT', 'NEWS_FEED', 'GROUPS', 'PROFILE', 'PHOTO', 'VIDEO'])
      .optional()
      .default('NEWS_FEED'),
  }),
  output: z
    .object({
      feedbackId: z.string(),
      viewerReactionId: z.string().nullable(),
      totalCount: z.number().nullable(),
      i18nTotalCount: z.string().nullable(),
      topReactions: z.array(TopReactionSchema),
      raw: z.unknown(),
    })
    .passthrough(),
};

// ============================================================================
// listReactors
// ============================================================================

export const listReactorsSchema = {
  name: 'listReactors',
  description:
    'List users who reacted to a feedback target, optionally filtered to one reaction type. Paginated.',
  notes: '',
  input: z.object({
    feedbackId: z.string().describe('Base64 feedback id of the target'),
    reaction: ReactionEnum.optional().describe(
      'Filter to one reaction type. Omit to list reactors across all reactions.',
    ),
    count: z.number().optional().default(10),
    cursor: z.string().nullable().optional(),
  }),
  output: z
    .object({
      reactors: z.array(
        z
          .object({
            id: z.string().describe('User id'),
            name: z.string().nullable(),
            profilePicUrl: z.string().nullable(),
            reactionId: z
              .string()
              .nullable()
              .describe('Numeric id of the reaction this user gave'),
          })
          .passthrough(),
      ),
      nextCursor: z.string().nullable(),
      hasNextPage: z.boolean(),
      raw: z.unknown(),
    })
    .passthrough(),
};

// ============================================================================
// getReactionsSummary
// ============================================================================

export const getReactionsSummarySchema = {
  name: 'getReactionsSummary',
  description:
    'Get the reaction-dialog tab metadata for a feedback target: per-reaction counts, totals, and tab keys.',
  notes: '',
  input: z.object({
    feedbackId: z.string().describe('Base64 feedback id of the target'),
    reaction: ReactionEnum.optional()
      .default('LIKE')
      .describe(
        'Initially-selected reaction tab. Does not filter the dialog content; use listReactors for filtered lists.',
      ),
  }),
  output: CommentsRawOutput,
};

// ============================================================================
// getReactorsByImportance
// ============================================================================

export const getReactorsByImportanceSchema = {
  name: 'getReactorsByImportance',
  description:
    'Get the "Important" reactor sub-list (friends and connections first) for a feedback target.',
  notes: '',
  input: z.object({
    feedbackId: z.string(),
    reaction: ReactionEnum.optional().default('LIKE'),
  }),
  output: CommentsRawOutput,
};

// ============================================================================
// getReactionTooltip
// ============================================================================

export const getReactionTooltipSchema = {
  name: 'getReactionTooltip',
  description:
    'Get the short hovercard list of names for a single reaction icon on a feedback target.',
  notes: '',
  input: z.object({
    feedbackId: z.string(),
    reaction: ReactionEnum.optional().default('LIKE'),
  }),
  output: CommentsRawOutput,
};

// ============================================================================
// startTypingComment / stopTypingComment
// ============================================================================

export const startTypingCommentSchema = {
  name: 'startTypingComment',
  description:
    'Broadcast a "viewer is typing" presence event on a feedback target. Optional; required only to mirror the live-typing UX.',
  notes:
    '`sessionId` is a per-composer UUID used to pair start/stop events. Generate one client-side and reuse it for the matching stopTypingComment call.',
  input: z.object({
    feedbackId: z.string(),
    sessionId: z
      .string()
      .describe(
        'Composer session UUID. Reuse the same value for the matching stop call.',
      ),
  }),
  output: CommentsRawOutput,
};

export const stopTypingCommentSchema = {
  name: 'stopTypingComment',
  description:
    'Broadcast a "viewer stopped typing" presence event on a feedback target.',
  notes: '',
  input: z.object({
    feedbackId: z.string(),
    sessionId: z
      .string()
      .describe('Same session UUID passed to startTypingComment.'),
  }),
  output: CommentsRawOutput,
};

// ============================================================================
// getMentionSuggestions
// ============================================================================

export const getMentionSuggestionsSchema = {
  name: 'getMentionSuggestions',
  description:
    'Get @-mention suggestions (users, pages, groups, events) to insert into comment or post text.',
  notes:
    "Returns the initial suggestion set the composer shows when opened. Use a returned `id` as the entity id in createComment's `messageRanges`.",
  input: z.object({
    limit: z.number().optional().default(10),
    mentionTypes: z
      .array(z.enum(['USER', 'WORKROOMS_USER', 'GROUP', 'EVENT', 'PAGE']))
      .optional()
      .default(['USER', 'WORKROOMS_USER', 'GROUP', 'EVENT', 'PAGE']),
  }),
  output: z
    .object({
      suggestions: z.array(
        z
          .object({
            id: z.string(),
            name: z.string().nullable(),
            type: z
              .string()
              .describe(
                'Profile typename: User, Page, Group, Event, or BatchMentions (e.g. @highlight, @everyone)',
              ),
            pictureUrl: z.string().nullable(),
            subtext: z
              .string()
              .nullable()
              .describe('Display subtitle, e.g. "Page · 2.2M followers"'),
            isEligible: z.boolean(),
          })
          .passthrough(),
      ),
      raw: z.unknown(),
    })
    .passthrough(),
};

export type CreateCommentInput = z.infer<typeof createCommentSchema.input>;
export type CreateCommentOutput = z.infer<typeof createCommentSchema.output>;
export type ReactToFeedbackInput = z.infer<typeof reactToFeedbackSchema.input>;
export type ReactToFeedbackOutput = z.infer<
  typeof reactToFeedbackSchema.output
>;
export type ListReactorsInput = z.infer<typeof listReactorsSchema.input>;
export type ListReactorsOutput = z.infer<typeof listReactorsSchema.output>;
export type GetReactionsSummaryInput = z.infer<
  typeof getReactionsSummarySchema.input
>;
export type GetReactorsByImportanceInput = z.infer<
  typeof getReactorsByImportanceSchema.input
>;
export type GetReactionTooltipInput = z.infer<
  typeof getReactionTooltipSchema.input
>;
export type StartTypingCommentInput = z.infer<
  typeof startTypingCommentSchema.input
>;
export type StopTypingCommentInput = z.infer<
  typeof stopTypingCommentSchema.input
>;
export type GetMentionSuggestionsInput = z.infer<
  typeof getMentionSuggestionsSchema.input
>;
export type GetMentionSuggestionsOutput = z.infer<
  typeof getMentionSuggestionsSchema.output
>;
export type CommentsResponse = z.infer<typeof CommentsRawOutput>;
