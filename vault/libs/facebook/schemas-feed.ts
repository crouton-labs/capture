import { z } from 'zod';

const FeedOutput = z.object({ data: z.unknown() }).passthrough();

const FeedItem = z.object({
  index: z
    .number()
    .describe(
      '1-based position in this feed snapshot. Stable until the next listHomeFeed call. Pass to getCachedFeedItem(index) to resolve back to the full record without re-fetching.',
    ),
  kind: z.enum(['story', 'pymk', 'suggestion_carousel', 'unknown']),
  sources: z
    .array(z.enum(['TOP_STORIES', 'MOST_RECENT']))
    .describe(
      "Which Facebook feed ranking(s) returned this item. `['TOP_STORIES']` = algorithmically promoted only; `['MOST_RECENT']` = chronological-only (a friend/page post that the ranker did not surface); both = the item appears in either view. Useful for telling organic friend posts apart from FB-promoted content.",
    ),
  storyID: z
    .string()
    .nullable()
    .describe(
      'Base64 `UzpfS...` token for kind=story. Pass to getPostPermalink({ storyID }) for the full post + comments. Null for non-story kinds.',
    ),
  actor: z.string().nullable().describe('Poster name for kind=story.'),
  message: z
    .string()
    .nullable()
    .describe('Post body text; null when the post has no caption.'),
  attachment: z
    .string()
    .nullable()
    .describe(
      'Attachment title or media __typename (Photo/Video/GenericAttachmentMedia); null when none.',
    ),
  ts: z.number().nullable().describe('Unix-seconds creation time.'),
  permalink: z.string().nullable(),
  pymkUsers: z
    .array(z.object({ id: z.string(), name: z.string() }))
    .nullable()
    .describe('Suggested users for kind=pymk; null otherwise.'),
  carouselTitle: z
    .string()
    .nullable()
    .describe('Header text for kind=suggestion_carousel.'),
  carouselSize: z
    .number()
    .nullable()
    .describe('Item count for kind=suggestion_carousel.'),
});

export const listHomeFeedSchema = {
  name: 'listHomeFeed',
  description:
    "Get the viewer's News Feed as a 1-indexed snapshot synthesized from BOTH Facebook rankings in a single call: the ranked Top Stories feed (algorithmically surfaced posts, suggested content, ads, PYMK rails) AND the Most Recent chronological feed (strict reverse-chrono from accounts the viewer follows). Items are deduped by storyID and ordered Top-Stories-first, then Most-Recent items not already surfaced. Each item carries a `sources` field showing which ranking(s) returned it, so consumers can distinguish algorithmically promoted content from organic chronological posts. Auto-paginates per ranking internally and caches the merged snapshot in browser localStorage so getCachedFeedItem can resolve any item by its index later in the conversation without re-fetching.",
  notes:
    "Returns the union of Top Stories and Most Recent — the agent does NOT need to call twice with different orderings. Includes every card `kind` (story, pymk, suggestion_carousel, unknown); do not filter to `kind === 'story'`. The merged result may exceed `first` because items unique to each ranking are appended. Use `sources` to read the provenance of each item: `['TOP_STORIES']` only = FB-promoted (likely a suggestion, ad, or reel from a non-followed account); `['MOST_RECENT']` only = chronological friend/page post the ranker chose not to promote; both = the item appears in either view. To act on a specific post, pass `items[].storyID` to getPostPermalink. Pagination is not exposed for the merged feed; raise `first` if you need more items.",
  input: z.object({
    first: z
      .number()
      .optional()
      .default(10)
      .describe(
        'Target number of items to collect from EACH underlying ranking (Top Stories and Most Recent) before merging. The merged result may exceed `first` due to items unique to each ranking. Auto-paginates internally per ranking when Facebook serves sparse first chunks.',
      ),
  }),
  output: z.object({
    items: z.array(FeedItem),
    cachedAt: z
      .number()
      .describe('Unix-ms timestamp when the snapshot was written.'),
  }),
};

export const getCachedFeedItemSchema = {
  name: 'getCachedFeedItem',
  description:
    'Look up a feed item from the most recent listHomeFeed() call by its 1-based index. Returns null `item` if no cache exists or the index is out of range.',
  notes: '',
  input: z.object({
    index: z
      .number()
      .describe('1-based index from the items array returned by listHomeFeed.'),
  }),
  output: z.object({
    item: FeedItem.nullable(),
    cachedAt: z
      .number()
      .nullable()
      .describe(
        'Unix-ms timestamp of the cached snapshot, or null if no cache exists.',
      ),
  }),
};

export const listStoriesSchema = {
  name: 'listStories',
  description: 'Get the horizontal Stories tray buckets visible to the viewer.',
  notes: '',
  input: z.object({
    bucketsToFetch: z.number().optional().default(6),
  }),
  output: FeedOutput,
};

export const getRightSideCardsSchema = {
  name: 'getRightSideCards',
  description:
    'Get the right-hand column cards on the home page (PYMK, birthdays, ads).',
  notes: '',
  input: z.object({
    refreshNum: z.number().optional().default(0),
  }),
  output: FeedOutput,
};

export const getMegaphoneSchema = {
  name: 'getMegaphone',
  description:
    'Get the system megaphone/announcement banner card for the viewer.',
  notes: '',
  input: z.object({}),
  output: FeedOutput,
};

export const getPostPermalinkSchema = {
  name: 'getPostPermalink',
  description:
    'Get a single post (the permalink-dialog payload): full feedback, attachments, owner, and the first page of comments.',
  notes:
    'storyID is the base64 `UzpfS...` token used by feed entries; found at `items[].storyID` in listHomeFeed and at `feedback.story.id` on photo/post responses.',
  input: z.object({
    storyID: z.string().describe('Base64 story id of the post'),
    focusCommentID: z
      .string()
      .nullable()
      .optional()
      .describe('Optional comment id to scroll/highlight in the dialog'),
  }),
  output: FeedOutput,
};

export type ListHomeFeedInput = z.infer<typeof listHomeFeedSchema.input>;
export type ListHomeFeedOutput = z.infer<typeof listHomeFeedSchema.output>;
export type FeedItemEntry = z.infer<typeof FeedItem>;
export type GetCachedFeedItemInput = z.infer<
  typeof getCachedFeedItemSchema.input
>;
export type GetCachedFeedItemOutput = z.infer<
  typeof getCachedFeedItemSchema.output
>;
export type ListStoriesInput = z.infer<typeof listStoriesSchema.input>;
export type GetRightSideCardsInput = z.infer<
  typeof getRightSideCardsSchema.input
>;
export type GetMegaphoneInput = z.infer<typeof getMegaphoneSchema.input>;
export type GetPostPermalinkInput = z.infer<
  typeof getPostPermalinkSchema.input
>;
export type FeedResponse = z.infer<typeof FeedOutput>;
