import { z } from 'zod';

export const libraryDescription =
  'Fathom meeting recorder: list calls, read transcripts, search across meetings';
export const libraryIcon = '/icons/libs/fathom.ico';
export const loginUrl = 'https://fathom.video';

export const libraryNotes = `
## Workflow

1. Navigate to \`https://fathom.video/home\`
2. Call \`getContext()\` to extract CSRF token and user info
3. Use returned \`csrf\` for any POST operations (search). GET operations only need cookies.

## Key Concepts

- **Calls**: Recorded meetings with transcripts, highlights, and AI-generated summaries
- **Transcript**: Full text of a call with speaker attribution and timestamps
- **Highlights**: AI-detected moments (positive reactions, pain points, feedback, etc.) embedded in transcripts
- **AI Search**: Semantic search across all calls; creates a query, then poll for results

## Pagination

\`listCalls\` uses cursor-based pagination. Pass \`nextCursor\` from a previous response to get the next page.

## Authentication

Cookie-based (credentials: 'include'). CSRF token from page meta tag for POST requests.
`;

// ============================================================================
// Context
// ============================================================================

export const getContextSchema = {
  name: 'getContext',
  description:
    'Extract CSRF token and current user info from Fathom (call FIRST)',
  notes: 'Must be on a fathom.video page.',
  input: z.object({}),
  output: z.object({
    csrf: z.string().describe('CSRF token for POST requests'),
    userId: z.number().describe('Current user ID'),
    firstName: z.string().describe('User first name'),
    lastName: z.string().describe('User last name'),
    email: z.string().describe('User email'),
  }),
};

export type GetContextInput = z.input<typeof getContextSchema.input>;
export type GetContextOutput = z.infer<typeof getContextSchema.output>;

// ============================================================================
// Calls
// ============================================================================

export const CallSummarySchema = z.object({
  id: z.number().describe('Call ID'),
  title: z.string().describe('Call title / meeting topic'),
  started_at: z.string().describe('ISO timestamp when call started'),
  duration_minutes: z.number().describe('Duration in minutes'),
  highlight_count: z.number().describe('Number of AI-detected highlights'),
  action_item_count: z.number().describe('Number of action items'),
  short_summary: z.string().nullable().describe('Brief AI-generated summary'),
  permalink: z.string().describe('Direct URL to call in Fathom'),
  host: z
    .object({
      first_name: z.string(),
      last_name: z.string(),
      email: z.string(),
    })
    .describe('Call host info'),
  internal: z.boolean().describe('Whether this was an internal meeting'),
  is_impromptu: z
    .boolean()
    .describe('Whether this was an impromptu/unscheduled meeting'),
  recording_duration_seconds: z
    .number()
    .describe('Actual recording duration in seconds'),
});

export const listCallsSchema = {
  name: 'listCalls',
  description: 'List recorded calls with pagination (most recent first)',
  notes: '',
  input: z.object({
    nextCursor: z
      .string()
      .optional()
      .describe(
        'Cursor from previous response for next page. Omit for first page.',
      ),
  }),
  output: z.object({
    calls: z.array(CallSummarySchema).describe('List of call summaries'),
    nextCursor: z
      .string()
      .nullable()
      .describe('Cursor for next page, null if no more results'),
    limit: z.number().describe('Page size'),
  }),
};

export type ListCallsInput = z.input<typeof listCallsSchema.input>;
export type ListCallsOutput = z.infer<typeof listCallsSchema.output>;

// ============================================================================
// Call Detail
// ============================================================================

export const SpeakerSchema = z.object({
  id: z.string().describe('Speaker ID (GID format)'),
  name: z.string().describe('Speaker display name'),
  is_host: z.boolean().describe('Whether this speaker is the call host'),
});

export const getCallSchema = {
  name: 'getCall',
  description: 'Get detailed metadata for a single call',
  notes: '',
  input: z.object({
    callId: z.number().describe('Call ID'),
  }),
  output: z.object({
    id: z.number().describe('Call ID'),
    title: z.string().describe('Call title'),
    started_at: z.string().describe('ISO timestamp when call started'),
    state: z.string().describe('Call state (e.g. finalized)'),
    duration_seconds: z.number().describe('Recording duration in seconds'),
    permalink: z.string().describe('Direct URL to call'),
    speakers: z.array(SpeakerSchema).describe('List of speakers in the call'),
    host: z
      .object({
        id: z.number(),
        first_name: z.string(),
        last_name: z.string(),
        email: z.string(),
      })
      .describe('Call host'),
    highlight_count: z.number().describe('Number of highlights'),
    action_item_count: z.number().describe('Number of action items'),
    bookmarks: z.array(z.any()).describe('User bookmarks on the call'),
    internal: z.boolean().describe('Whether internal meeting'),
    video_url: z.string().nullable().describe('HLS video URL (if available)'),
    audio_url: z.string().nullable().describe('Audio URL (if available)'),
    share_url: z
      .string()
      .nullable()
      .describe('Public share URL if sharing enabled'),
  }),
};

export type GetCallInput = z.input<typeof getCallSchema.input>;
export type GetCallOutput = z.infer<typeof getCallSchema.output>;

// ============================================================================
// Transcript
// ============================================================================

export const getTranscriptSchema = {
  name: 'getTranscript',
  description:
    'Get the full transcript with highlights for a call. Returns both HTML and plain text formats with speaker attribution and timestamps.',
  notes: '',
  input: z.object({
    callId: z.number().describe('Call ID'),
  }),
  output: z.object({
    html: z
      .string()
      .describe(
        'Full transcript as HTML with highlight colors and timestamp links',
      ),
    plain_text: z
      .string()
      .describe(
        'Full transcript as plain text with speaker names, timestamps, and highlight labels',
      ),
  }),
};

export type GetTranscriptInput = z.input<typeof getTranscriptSchema.input>;
export type GetTranscriptOutput = z.infer<typeof getTranscriptSchema.output>;

// ============================================================================
// Search
// ============================================================================

export const SearchResultQuerySchema = z.object({
  id: z.number().describe('Search query ID'),
  query: z.string().describe('Original search query'),
  refined_query: z.string().describe('AI-refined version of the query'),
  completed_at: z
    .string()
    .nullable()
    .describe('ISO timestamp when search completed'),
  failed_at: z.string().nullable().describe('ISO timestamp if search failed'),
});

export const SearchResultEntrySchema = z
  .object({})
  .passthrough()
  .describe(
    'Search result entry: shape varies. Common fields: call_id, call_title, timestamp, snippet, highlight_type',
  );

export const searchCallsSchema = {
  name: 'searchCalls',
  description:
    'Search across all calls using AI-powered semantic search. Creates a search query and returns the query metadata and result entries URL. Results may take a few seconds to process.',
  notes:
    'Search is async. If results are empty and processingMore is true, wait and re-fetch the resultEntriesUrl.',
  input: z.object({
    csrf: z.string().describe('CSRF token from getContext()'),
    query: z.string().describe('Natural language search query'),
  }),
  output: z.object({
    resultQuery: SearchResultQuerySchema.describe('Search query metadata'),
    resultEntriesUrl: z
      .string()
      .describe(
        'Relative URL to fetch search result entries (GET with credentials)',
      ),
    entries: z
      .array(SearchResultEntrySchema)
      .describe('Search result entries (may be empty if still processing)'),
    hasMoreResults: z.boolean().describe('Whether more results are available'),
    processingMore: z
      .boolean()
      .describe('Whether the search is still processing more results'),
  }),
};

export type SearchCallsInput = z.input<typeof searchCallsSchema.input>;
export type SearchCallsOutput = z.infer<typeof searchCallsSchema.output>;

// ============================================================================
// All Schemas Export
// ============================================================================

export const allSchemas = [
  getContextSchema,
  listCallsSchema,
  getCallSchema,
  getTranscriptSchema,
  searchCallsSchema,
];
