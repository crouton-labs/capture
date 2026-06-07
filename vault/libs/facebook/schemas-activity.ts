import { z } from 'zod';

const ActivityOutput = z.object({ data: z.unknown() }).passthrough();

export const listActivityLogSchema = {
  name: 'listActivityLog',
  description:
    "List entries from the viewer's Activity Log (posts, likes, comments, searches, etc.).",
  notes:
    '`category` selects which activity type is returned. Common codes: ALL, VIDEOSEARCH (watched videos), SEARCH (search history), LIKES, COMMENTS, POSTS, TAGGED, YOURACTIVITYPOSTSSCHEMA (your posts, source for trashing posts), YOURACTIVITYSTORIESSCHEMA (your stories, source for deleting stories). Paginate with `cursor`. Each row exposes `post_id_str` and `story_id` needed by curateActivityLogItem.',
  input: z.object({
    category: z
      .string()
      .optional()
      .default('ALL')
      .describe('Activity category code. ALL for everything.'),
    count: z.number().optional().default(25),
    cursor: z.string().nullable().optional(),
    year: z.number().nullable().optional(),
    month: z.number().nullable().optional(),
  }),
  output: ActivityOutput,
};

export const getActivityLogViewerSchema = {
  name: 'getActivityLogViewer',
  description:
    'Get the Activity Log viewer metadata (user info, available categories).',
  notes: '',
  input: z.object({}),
  output: ActivityOutput,
};

export const curateActivityLogItemSchema = {
  name: 'curateActivityLogItem',
  description:
    "Act on one of the viewer's past Activity Log items: remove a comment the viewer made, permanently delete a story, or move a post to Trash.",
  notes:
    'List the relevant Activity Log category first (listActivityLog) to obtain `postId` and `storyId` for the target row. `action` must match `categoryKey`: REMOVE_COMMENT with COMMENTSCLUSTER (deletes a comment), DELETE with YOURACTIVITYSTORIESSCHEMA (permanently deletes a story), MOVE_TO_TRASH with YOURACTIVITYPOSTSSCHEMA (moves a post to Trash, recoverable for 30 days).',
  input: z.object({
    action: z
      .enum(['REMOVE_COMMENT', 'DELETE', 'MOVE_TO_TRASH'])
      .describe(
        'Curation action. REMOVE_COMMENT deletes a comment; DELETE permanently removes a story; MOVE_TO_TRASH soft-deletes a post.',
      ),
    categoryKey: z
      .string()
      .optional()
      .default('COMMENTSCLUSTER')
      .describe(
        'Activity Log category. COMMENTSCLUSTER for comments, YOURACTIVITYSTORIESSCHEMA for stories, YOURACTIVITYPOSTSSCHEMA for posts.',
      ),
    postId: z
      .string()
      .describe(
        'Numeric id of the target item (Activity Log row `post_id_str`).',
      ),
    storyId: z.string().describe('Base64 story id of the Activity Log row.'),
    storyLocation: z.string().optional().default('ACTIVITY_LOG'),
  }),
  output: z
    .object({
      success: z.boolean(),
      storyId: z.string().nullable(),
      error: z.unknown().nullable(),
      raw: z.unknown(),
    })
    .passthrough(),
};

export type ListActivityLogInput = z.infer<typeof listActivityLogSchema.input>;
export type GetActivityLogViewerInput = z.infer<
  typeof getActivityLogViewerSchema.input
>;
export type CurateActivityLogItemInput = z.infer<
  typeof curateActivityLogItemSchema.input
>;
export type CurateActivityLogItemOutput = z.infer<
  typeof curateActivityLogItemSchema.output
>;
export type ActivityResponse = z.infer<typeof ActivityOutput>;
