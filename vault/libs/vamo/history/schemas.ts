import { z } from 'zod';

const ProjectIdParam = z.string().describe('Project UUID from getContext()');

export const listSearchHistorySchema = {
  name: 'listSearchHistory',
  description:
    'List recent searches the current user has run in this Vamo project, newest first.',
  notes: '',
  input: z.object({
    projectId: ProjectIdParam,
  }),
  output: z
    .object({
      searches: z.array(
        z
          .object({
            id: z.string(),
            userId: z.string(),
            projectId: z.string(),
            query: z
              .string()
              .describe(
                'The display query — for username searches the leading "@" is included',
              ),
            searchParams: z
              .string()
              .describe(
                'URL query string used to re-run the search, e.g. "?q=react&sort=relevant&lang=TypeScript"',
              ),
            createdAt: z.string(),
          })
          .passthrough(),
      ),
    })
    .passthrough(),
};
export type ListSearchHistoryInput = z.infer<
  typeof listSearchHistorySchema.input
>;
export type ListSearchHistoryOutput = z.infer<
  typeof listSearchHistorySchema.output
>;

export const historySchemas = [listSearchHistorySchema];
