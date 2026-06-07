import { z } from 'zod';

const AuraTokenParam = z.string().describe('Aura token from getContext()');
const AuraContextParam = z.string().describe('Aura context from getContext()');

const SObjectRecord = z
  .object({ Id: z.string().describe('Salesforce record ID') })
  .passthrough();

const FeedCommentRecord = z
  .object({
    Id: z.string().describe('FeedComment record ID'),
    FeedItemId: z
      .string()
      .describe('ID of the parent FeedItem this comment belongs to'),
    CommentBody: z.string().describe('Text content of the comment'),
    CreatedDate: z
      .string()
      .describe('ISO 8601 timestamp when the comment was created'),
    CreatedById: z.string().describe('User ID of the comment author'),
  })
  .passthrough();

const SaveResult = z.object({
  id: z.string().describe('ID of the created record'),
  record: SObjectRecord.describe('Full record as returned by Salesforce'),
});

export const listFeedItemsSchema = {
  name: 'listFeedItems',
  description:
    'List Chatter feed items (posts) with pagination. Requires Chatter to be enabled; throws an error on orgs that use Slack instead of Chatter.',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    parentId: z
      .string()
      .optional()
      .describe(
        'Filter feed items by parent record ID (e.g., an Account or Opportunity ID)',
      ),
    pageSize: z.number().optional().describe('Results per page (default 25)'),
    page: z
      .number()
      .optional()
      .describe('Page number, zero-indexed (default 0)'),
    sortBy: z
      .string()
      .optional()
      .describe(
        'Field API name to sort results by (e.g. "CreatedDate", "LastModifiedDate"). Prefix with "-" for descending order (e.g. "-CreatedDate" for newest first)',
      ),
    layoutType: z
      .enum(['FULL', 'COMPACT', 'SEARCH'])
      .optional()
      .describe(
        'Controls which fields are returned on each record. FULL returns all layout fields (default), COMPACT returns fewer fields, SEARCH returns search-optimized fields',
      ),
  }),
  output: z.object({
    totalCount: z
      .number()
      .describe(
        'Total number of feed items matching the filter. Falls back to the length of feedItems if the server does not return a count',
      ),
    feedItems: z
      .array(SObjectRecord)
      .describe(
        'Array of FeedItem records with ParentId, Body, Type, CreatedDate, CreatedById',
      ),
  }),
  notes:
    'Requires Chatter to be enabled in the Salesforce org. Throws an error if Chatter is disabled or replaced by Slack Channels (common on Starter/Essentials editions and orgs that migrated to Slack). Check the error message to determine if the org supports Chatter.',
};

export type ListFeedItemsInput = z.infer<typeof listFeedItemsSchema.input>;
export type ListFeedItemsOutput = z.infer<typeof listFeedItemsSchema.output>;

export const createFeedItemSchema = {
  name: 'createFeedItem',
  description: 'Create a Chatter post (FeedItem) on a record or user feed',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    parentId: z
      .string()
      .describe(
        'ID of the record or user to post on (Account, Opportunity, User, etc.)',
      ),
    body: z.string().describe('Text content of the post'),
    type: z
      .enum([
        'TextPost',
        'LinkPost',
        'ContentPost',
        'QuestionPost',
        'PollPost',
        'AdvancedTextPost',
        'AnnouncementPost',
      ])
      .optional()
      .describe(
        'Type of feed item. TextPost for plain text, LinkPost for URL sharing (requires title and linkUrl), ContentPost for file attachments. Defaults to TextPost',
      ),
    title: z
      .string()
      .optional()
      .describe(
        'Title of the feed item. Required for LinkPost and ContentPost types',
      ),
    linkUrl: z
      .string()
      .optional()
      .describe('URL to share. Used with LinkPost type'),
    isRichText: z
      .boolean()
      .optional()
      .describe(
        'When true, Body is treated as rich text (HTML markup). Defaults to false (plain text)',
      ),
    visibility: z
      .enum(['AllUsers', 'InternalUsers'])
      .optional()
      .describe(
        'Controls who can see the post. AllUsers includes external/community users, InternalUsers limits to internal org users',
      ),
    networkScope: z
      .string()
      .optional()
      .describe(
        'Salesforce Community scope. Set to AllNetworks for all communities, or a specific Network ID. Only applies when Communities is enabled',
      ),
    relatedRecordId: z
      .string()
      .optional()
      .describe(
        'ContentVersion ID to attach a file to this post. Set type to ContentPost when using this. Get the ID by uploading a file first via ContentVersion',
      ),
  }),
  output: SaveResult,
  notes:
    'Requires Chatter to be enabled in the Salesforce org. Returns INSUFFICIENT_ACCESS error if Chatter is disabled or replaced by Slack Channels. Orgs using Slack for Salesforce instead of Chatter cannot create FeedItems via this function.',
};

export type CreateFeedItemInput = z.infer<typeof createFeedItemSchema.input>;
export type CreateFeedItemOutput = z.infer<typeof createFeedItemSchema.output>;

export const listFeedCommentsSchema = {
  name: 'listFeedComments',
  description:
    'List comments on a Chatter feed item. Returns FeedComment records for the given FeedItem ID with pagination.',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    feedItemId: z
      .string()
      .describe(
        'FeedItem ID to list comments for (starts with 0D5). Get from listFeedItems or createFeedItem',
      ),
    pageSize: z.number().optional().describe('Results per page (default 25)'),
    page: z
      .number()
      .optional()
      .describe('Page number, zero-indexed (default 0)'),
    sortBy: z
      .string()
      .optional()
      .describe(
        'Field API name to sort results by (e.g. CreatedDate, CommentBody). Prefix with - for descending order (e.g. -CreatedDate)',
      ),
    layoutType: z
      .enum(['FULL', 'COMPACT', 'SEARCH'])
      .optional()
      .describe(
        'Controls which fields are returned on each record. FULL returns all layout fields (default), COMPACT returns fewer fields, SEARCH returns search-optimized fields',
      ),
  }),
  output: z.object({
    totalCount: z
      .number()
      .describe(
        'Total number of feed comments matching the filter. Falls back to the length of feedComments if the server does not return a count',
      ),
    feedComments: z
      .array(FeedCommentRecord)
      .describe(
        'Array of FeedComment records. Each record includes Id, FeedItemId, CommentBody, CreatedDate, CreatedById, plus additional fields from the layout',
      ),
  }),
  notes:
    'Requires Chatter to be enabled in the Salesforce org. Throws an error if Chatter is disabled or replaced by Slack Channels (common on Starter/Essentials editions and orgs that migrated to Slack). The feedItemId must be a valid FeedItem record ID (prefix 0D5); passing an ID with a different prefix (e.g., Account 001, Contact 003) throws a validation error. Returns an empty feedComments array when no comments exist for the given FeedItem.',
};

export type ListFeedCommentsInput = z.infer<
  typeof listFeedCommentsSchema.input
>;
export type ListFeedCommentsOutput = z.infer<
  typeof listFeedCommentsSchema.output
>;

export const createFeedCommentSchema = {
  name: 'createFeedComment',
  description:
    'Add a comment to a Chatter feed item. Requires Chatter to be enabled in the org.',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    feedItemId: z
      .string()
      .describe(
        'FeedItem ID to comment on (starts with 0D5). Get from createFeedItem or listFeedItems',
      ),
    commentBody: z.string().describe('Text content of the comment'),
    isRichText: z
      .boolean()
      .optional()
      .describe(
        'When true, CommentBody is treated as rich text (HTML markup). Defaults to false (plain text)',
      ),
    commentType: z
      .enum(['TextComment', 'ContentComment'])
      .optional()
      .describe(
        'Type of comment. TextComment for text-only, ContentComment when attaching a file via relatedRecordId. Defaults to TextComment',
      ),
    relatedRecordId: z
      .string()
      .optional()
      .describe(
        'ContentVersion ID to attach a file to this comment. Set commentType to ContentComment when using this',
      ),
    threadParentId: z
      .string()
      .optional()
      .describe(
        'FeedComment ID to reply to as a threaded/nested reply within the same feed item',
      ),
  }),
  output: SaveResult,
  notes:
    'Requires Chatter to be enabled in the Salesforce org. Returns INSUFFICIENT_ACCESS error if Chatter is disabled.',
};

export type CreateFeedCommentInput = z.infer<
  typeof createFeedCommentSchema.input
>;
export type CreateFeedCommentOutput = z.infer<
  typeof createFeedCommentSchema.output
>;

export const chatterSchemas = [
  listFeedItemsSchema,
  createFeedItemSchema,
  listFeedCommentsSchema,
  createFeedCommentSchema,
];
