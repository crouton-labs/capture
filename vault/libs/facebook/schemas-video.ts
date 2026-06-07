import { z } from 'zod';

const VideoOutput = z.object({ data: z.unknown() }).passthrough();

export const listVideoFeedSchema = {
  name: 'listVideoFeed',
  description: 'List entries from the Reels / Watch video feed.',
  notes: 'Paginated with an opaque `cursor` returned by each response.',
  input: z.object({
    count: z.number().optional().default(5),
    cursor: z.string().nullable().optional(),
  }),
  output: VideoOutput,
};

export const getVideoEntrypointSchema = {
  name: 'getVideoEntrypoint',
  description:
    'Get the initial node for the video tab (the first reel shown when Reels opens).',
  notes: '',
  input: z.object({}),
  output: VideoOutput,
};

export const getWatchBadgeCountSchema = {
  name: 'getWatchBadgeCount',
  description: 'Get the unseen Watch-tab badge count for the viewer.',
  notes: '',
  input: z.object({}),
  output: VideoOutput,
};

export type ListVideoFeedInput = z.infer<typeof listVideoFeedSchema.input>;
export type GetVideoEntrypointInput = z.infer<
  typeof getVideoEntrypointSchema.input
>;
export type GetWatchBadgeCountInput = z.infer<
  typeof getWatchBadgeCountSchema.input
>;
export type VideoResponse = z.infer<typeof VideoOutput>;
