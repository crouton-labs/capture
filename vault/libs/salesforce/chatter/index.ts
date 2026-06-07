/**
 * Salesforce Chatter Operations
 *
 * Feed item and comment operations via Aura framework API.
 */

import { auraAction, DESCRIPTORS, validateString } from '../aura';
import type { AuraContext } from '../aura';
import { Validation, UpstreamError } from '@vallum/_runtime';
import type {
  ListFeedItemsInput,
  ListFeedItemsOutput,
  CreateFeedItemInput,
  CreateFeedItemOutput,
  ListFeedCommentsInput,
  ListFeedCommentsOutput,
  CreateFeedCommentInput,
  CreateFeedCommentOutput,
} from './schemas';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

interface RecordUiResult {
  id: string;
  apiName: string;
  fields: Record<string, { displayValue: string | null; value: unknown }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildCtx(creds: {
  auraToken: string;
  auraContext: string;
}): AuraContext {
  return { token: creds.auraToken, context: creds.auraContext };
}


function flattenRecordUiFields(result: RecordUiResult): {
  Id: string;
  [key: string]: unknown;
} {
  const record: { Id: string; [key: string]: unknown } = { Id: result.id };
  for (const [key, field] of Object.entries(result.fields)) {
    record[key] = field.value;
  }
  return record;
}

// ---------------------------------------------------------------------------
// List Feed Items
// ---------------------------------------------------------------------------

export async function listFeedItems(
  args: ListFeedItemsInput,
): Promise<ListFeedItemsOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');

  const ctx = buildCtx(args);

  // Verify Chatter is enabled by checking FeedItem object accessibility.
  // On orgs where Chatter is disabled or replaced by Slack, getObjectInfo
  // returns INSUFFICIENT_ACCESS (403).
  try {
    await auraAction(ctx, DESCRIPTORS.getObjectInfo, {
      objectApiName: 'FeedItem',
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes('INSUFFICIENT_ACCESS') ||
      msg.includes("don't have access")
    ) {
      throw new UpstreamError(
        'listFeedItems: Chatter is not enabled on this org. FeedItem object is inaccessible. ' +
          'This org may use Slack Channels instead of Chatter.',
      );
    }
    throw err;
  }

  const params: Record<string, unknown> = {
    entityNameOrId: 'FeedItem',
    layoutType: args.layoutType ?? 'FULL',
    pageSize: args.pageSize ?? 25,
    currentPage: args.page ?? 0,
    useTimeout: false,
    getCount: true,
    enableRowActions: false,
  };

  if (args.parentId) {
    params.filterBy = args.parentId;
  }

  if (args.sortBy != null) {
    params.sortBy = args.sortBy;
  }

  const raw = await auraAction(ctx, DESCRIPTORS.getItems, params);

  const result = raw as {
    result?: Array<{ record: Record<string, unknown> }>;
    count?: number;
    totalCount?: number;
  };

  const feedItems = (result.result ?? []).map(
    (item) => item.record as ListFeedItemsOutput['feedItems'][number],
  );

  return {
    totalCount: result.count ?? result.totalCount ?? feedItems.length,
    feedItems,
  };
}

// ---------------------------------------------------------------------------
// Create Feed Item
// ---------------------------------------------------------------------------

export async function createFeedItem(
  args: CreateFeedItemInput,
): Promise<CreateFeedItemOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.parentId, 'parentId');
  validateString(args.body, 'body');

  const ctx = buildCtx(args);

  const fields: Record<string, unknown> = {
    ParentId: args.parentId,
    Body: args.body,
    Type: args.type ?? 'TextPost',
  };

  if (args.title != null) fields.Title = args.title;
  if (args.linkUrl != null) fields.LinkUrl = args.linkUrl;
  if (args.isRichText != null) fields.IsRichText = args.isRichText;
  if (args.visibility != null) fields.Visibility = args.visibility;
  if (args.networkScope != null) fields.NetworkScope = args.networkScope;
  if (args.relatedRecordId != null)
    fields.RelatedRecordId = args.relatedRecordId;

  const raw = await auraAction(ctx, DESCRIPTORS.createRecord, {
    recordInput: {
      apiName: 'FeedItem',
      fields,
    },
  });

  const result = raw as RecordUiResult;

  return {
    id: result.id,
    record: flattenRecordUiFields(result),
  };
}

// ---------------------------------------------------------------------------
// List Feed Comments
// ---------------------------------------------------------------------------

export async function listFeedComments(
  args: ListFeedCommentsInput,
): Promise<ListFeedCommentsOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.feedItemId, 'feedItemId');

  // Validate FeedItem ID prefix
  if (!args.feedItemId.startsWith('0D5')) {
    throw new Validation(
      `listFeedComments: Invalid feedItemId "${args.feedItemId}". FeedItem IDs must start with prefix "0D5". ` +
        'Get a valid FeedItem ID from listFeedItems or createFeedItem.',
    );
  }

  const ctx = buildCtx(args);

  // Verify Chatter is enabled by checking FeedComment object accessibility.
  // On orgs where Chatter is disabled or replaced by Slack, getObjectInfo
  // returns INSUFFICIENT_ACCESS (403).
  try {
    await auraAction(ctx, DESCRIPTORS.getObjectInfo, {
      objectApiName: 'FeedComment',
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes('INSUFFICIENT_ACCESS') ||
      msg.includes("don't have access")
    ) {
      throw new UpstreamError(
        'listFeedComments: Chatter is not enabled on this org. FeedComment object is inaccessible. ' +
          'This org may use Slack Channels instead of Chatter.',
      );
    }
    throw err;
  }

  const params: Record<string, unknown> = {
    entityNameOrId: 'FeedComment',
    layoutType: args.layoutType ?? 'FULL',
    pageSize: args.pageSize ?? 25,
    currentPage: args.page ?? 0,
    useTimeout: false,
    getCount: true,
    enableRowActions: false,
    filterBy: args.feedItemId,
  };

  if (args.sortBy) {
    params.sortBy = args.sortBy;
  }

  const raw = await auraAction(ctx, DESCRIPTORS.getItems, params);

  const result = raw as {
    result?: Array<{ record: Record<string, unknown> }>;
    count?: number;
    totalCount?: number;
  };

  const feedComments = (result.result ?? []).map(
    (item) => item.record as ListFeedCommentsOutput['feedComments'][number],
  );

  return {
    totalCount: result.count ?? result.totalCount ?? feedComments.length,
    feedComments,
  };
}

// ---------------------------------------------------------------------------
// Create Feed Comment
// ---------------------------------------------------------------------------

export async function createFeedComment(
  args: CreateFeedCommentInput,
): Promise<CreateFeedCommentOutput> {
  validateString(args.auraToken, 'auraToken');
  validateString(args.auraContext, 'auraContext');
  validateString(args.feedItemId, 'feedItemId');
  validateString(args.commentBody, 'commentBody');

  const ctx = buildCtx(args);

  const fields: Record<string, unknown> = {
    FeedItemId: args.feedItemId,
    CommentBody: args.commentBody,
  };

  if (args.isRichText != null) fields.IsRichText = args.isRichText;
  if (args.commentType != null) fields.CommentType = args.commentType;
  if (args.relatedRecordId != null)
    fields.RelatedRecordId = args.relatedRecordId;
  if (args.threadParentId != null) fields.ThreadParentId = args.threadParentId;

  const raw = await auraAction(ctx, DESCRIPTORS.createRecord, {
    recordInput: {
      apiName: 'FeedComment',
      fields,
    },
  });

  const result = raw as RecordUiResult;

  return {
    id: result.id,
    record: flattenRecordUiFields(result),
  };
}
