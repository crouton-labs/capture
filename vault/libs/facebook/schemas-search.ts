import { z } from 'zod';

const PassthroughOutput = z.object({ data: z.unknown() }).passthrough();
export type SearchResponse = z.infer<typeof PassthroughOutput>;

// ============================================================================
// getBootstrapKeywords (existing)
// ============================================================================

export const getBootstrapKeywordsSchema = {
  name: 'getBootstrapKeywords',
  description:
    'Get the precomputed popular keywords list used to populate the search autocomplete.',
  notes:
    'This is the static keyword index Facebook ships with the page. It does not execute a search and does not depend on a query string. For live as-you-type suggestions use getKeywordSuggestions; for full search use searchAll.',
  input: z.object({
    first: z.number().optional().default(2000),
  }),
  output: PassthroughOutput,
};
export type GetBootstrapKeywordsInput = z.infer<
  typeof getBootstrapKeywordsSchema.input
>;

// ============================================================================
// searchAll
// ============================================================================

const SearchResultsOutputSchema = z
  .object({
    results: z
      .array(
        z
          .object({
            entityId: z
              .string()
              .nullable()
              .describe('Numeric id of the matched user / page / group'),
            entityType: z
              .string()
              .nullable()
              .describe(
                'GraphQL __typename of the matched entity: "User", "Page", "Group", "Event", etc.',
              ),
            name: z.string().nullable(),
            url: z.string().nullable(),
            profilePicUrl: z.string().nullable(),
            subtitle: z
              .string()
              .nullable()
              .describe('Context line, e.g. "Friend of John, Lives in NYC"'),
          })
          .passthrough(),
      )
      .describe('Top-N search results for the query'),
    cursor: z
      .string()
      .nullable()
      .describe(
        'Opaque cursor string. Pass back as `cursor` on the next call to fetch the next page. Null when no more results.',
      ),
    raw: z.unknown(),
  })
  .passthrough();

export const searchAllSchema = {
  name: 'searchAll',
  description:
    'Run a global Facebook search across all result types (people, pages, groups, posts, events). Returns top results with entity ids ready to feed into getProfileHeader / getProfileHovercard.',
  notes:
    'Results aggregate across all visible category modules (People, Pages, Groups, etc.); inspect entityType to filter. `count` controls the number of category modules fetched, not the number of results — each module typically returns ~5 entities, so a single call may yield 20+ results. Cursor pagination is module-level, not entity-level.',
  input: z.object({
    query: z.string().describe('Search text'),
    count: z
      .number()
      .optional()
      .default(5)
      .describe(
        'Number of category modules to fetch. Each module returns ~5 entities, so total results ≈ count × 5.',
      ),
    cursor: z.string().nullable().optional(),
  }),
  output: SearchResultsOutputSchema,
};
export type SearchAllInput = z.infer<typeof searchAllSchema.input>;
export type SearchAllOutput = z.infer<typeof searchAllSchema.output>;

// ============================================================================
// searchPeople
// ============================================================================

export const searchPeopleSchema = {
  name: 'searchPeople',
  description:
    'Run a People-only Facebook search and paginate exhaustively through every match. Use this instead of searchAll when you need more than the SERP overview surfaces (~5 people per call); searchPeople will paginate through dozens of matches.',
  notes:
    'First call performs a one-shot SERP bootstrap to discover the People-tab experience parameter; subsequent calls reuse it via the wrapped cursor with no extra round trip. Pages typically yield 6-8 entities each. Returns entityType="User" for every result.',
  input: z.object({
    query: z.string().describe('Person name or freeform search text'),
    count: z
      .number()
      .optional()
      .default(5)
      .describe('Page size hint. Real page yields 6-8 entities regardless.'),
    cursor: z
      .string()
      .nullable()
      .optional()
      .describe('Wrapped cursor from a previous searchPeople response.'),
  }),
  output: SearchResultsOutputSchema,
};
export type SearchPeopleInput = z.infer<typeof searchPeopleSchema.input>;
export type SearchPeopleOutput = z.infer<typeof searchPeopleSchema.output>;

// ============================================================================
// getKeywordSuggestions
// ============================================================================

const KeywordSuggestionsOutputSchema = z
  .object({
    suggestions: z
      .array(
        z
          .object({
            text: z
              .string()
              .nullable()
              .describe('Suggested completion / phrase'),
            type: z.string().nullable().optional(),
          })
          .passthrough(),
      )
      .describe('As-you-type keyword completions'),
    raw: z.unknown(),
  })
  .passthrough();

export const getKeywordSuggestionsSchema = {
  name: 'getKeywordSuggestions',
  description:
    'Get live as-you-type search suggestions for a partial query. Mirrors what the search-bar dropdown displays.',
  notes:
    'For very short queries (e.g. one character) Facebook may return an empty list.',
  input: z.object({
    query: z.string().describe('Partial query text'),
    fetchCount: z.number().optional().default(8),
  }),
  output: KeywordSuggestionsOutputSchema,
};
export type GetKeywordSuggestionsInput = z.infer<
  typeof getKeywordSuggestionsSchema.input
>;
export type GetKeywordSuggestionsOutput = z.infer<
  typeof getKeywordSuggestionsSchema.output
>;

// ============================================================================
// recordTypeaheadSelection (mutation)
// ============================================================================

const RecordTypeaheadSelectionOutputSchema = z
  .object({
    clientMutationId: z
      .string()
      .nullable()
      .describe('Echoes the request mutation id'),
    raw: z.unknown(),
  })
  .passthrough();

export const recordTypeaheadSelectionSchema = {
  name: 'recordTypeaheadSelection',
  description:
    'Record that the user selected a typeahead suggestion. Pure analytics / personalization mutation; does not navigate or affect search results. Useful only when emulating realistic browser traffic for anti-bot purposes.',
  notes: '',
  input: z.object({
    query: z.string().describe('The text the user typed in the search bar'),
    selectedText: z
      .string()
      .describe(
        'The suggestion text actually picked (often equals query when picking the freeform option)',
      ),
    selectedType: z
      .string()
      .optional()
      .default('keyword')
      .describe(
        'Type of selection: "keyword", "user", "page", etc. Defaults to "keyword".',
      ),
  }),
  output: RecordTypeaheadSelectionOutputSchema,
};
export type RecordTypeaheadSelectionInput = z.infer<
  typeof recordTypeaheadSelectionSchema.input
>;
export type RecordTypeaheadSelectionOutput = z.infer<
  typeof recordTypeaheadSelectionSchema.output
>;
