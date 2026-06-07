import { z } from 'zod';

export const libraryDescription =
  'BBC News — fetch homepage articles and context from bbc.com';
export const libraryVisibility = 'chat' as const;
export const libraryIcon = '/icons/libs/bbc.png';
export const loginUrl = 'https://www.bbc.com/news';

export const libraryNotes = `
## Workflow
1. Call getContext to discover the current page state and any session info
2. Call getHomepage to fetch the latest headlines from the BBC News homepage

## Key Concepts
- BBC News homepage is publicly accessible, no auth required
- Articles are rendered server-side with structured data
`;

export const getContextSchema = {
  name: 'getContext',
  description:
    'Get the current BBC session context including page metadata and user state',
  notes: '',
  input: z.object({}),
  output: z.object({
    pageTitle: z.string().describe('Current page title'),
    currentUrl: z.string().describe('Current page URL'),
    isLoggedIn: z.boolean().describe('Whether user is logged in'),
    region: z.string().describe('Detected region'),
  }),
};

const ArticleSchema = z.object({
  id: z.string().describe('Article identifier'),
  title: z.string().describe('Headline text'),
  summary: z.string().describe('Article summary or standfirst'),
  url: z.string().describe('Full article URL'),
  section: z.string().describe('News section (e.g. World, Business, Sport)'),
  publishedAt: z.string().describe('ISO timestamp of publication'),
});

export const getHomepageSchema = {
  name: 'getHomepage',
  description: 'Fetch the current BBC News homepage articles and top stories',
  notes: '',
  input: z.object({
    limit: z
      .number()
      .optional()
      .describe('Max number of articles to return (default 20)'),
  }),
  output: z.object({
    articles: z.array(ArticleSchema).describe('Homepage articles'),
    lastUpdated: z.string().describe('When the homepage was last refreshed'),
  }),
};

export const allSchemas = [getContextSchema, getHomepageSchema];

export type GetContextInput = z.infer<typeof getContextSchema.input>;
export type GetContextOutput = z.infer<typeof getContextSchema.output>;
export type GetHomepageInput = z.infer<typeof getHomepageSchema.input>;
export type GetHomepageOutput = z.infer<typeof getHomepageSchema.output>;
export type Article = z.infer<typeof ArticleSchema>;
